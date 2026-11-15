// Development session launcher: native terminal and Discord share one persistent local runtime.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../lib/root.mjs';
import { codexEnvironment, developmentConfig } from './_discord-lead.mjs';

export function validateRuntime(runtime) {
  const url = new URL(runtime.endpoint);
  if (
    runtime.version !== 1 ||
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(runtime.token || '')
  )
    throw new Error('Invalid local lead runtime. Use the terminal launcher.');
  return runtime;
}

// Closing this client never terminates the host or another client's work.
export class SharedCodexRpc {
  constructor(
    runtime,
    { onEvent = () => {}, onRequest = () => {}, onExit = () => {}, Socket = WebSocket } = {},
  ) {
    validateRuntime(runtime);
    this.nextId = 0;
    this.pending = new Map();
    this.socket = new Socket(runtime.endpoint, {
      headers: { Authorization: 'Bearer ' + runtime.token },
    });
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      const failed = () => reject(new Error('Local lead runtime connection failed.'));
      this.socket.addEventListener('error', failed, { once: true });
      this.socket.addEventListener('close', failed, { once: true });
    });
    const fail = () => {
      if (this.disconnected) return;
      this.disconnected = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Local lead runtime disconnected.'));
      }
      this.pending.clear();
      onExit();
    };
    this.socket.addEventListener('close', fail);
    this.socket.addEventListener('error', fail);
    this.socket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.method) {
        if (message.id !== undefined) onRequest(message);
        else onEvent(message);
      } else if (this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`Codex RPC error (${message.error.code}).`));
        else resolve(message.result);
      }
    });
  }

  write(message) {
    this.socket.send(JSON.stringify(message));
  }

  async request(method, params = {}) {
    await this.ready;
    if (this.disconnected) throw new Error('Local lead runtime disconnected.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out; inspect the terminal before retrying.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Local lead runtime write failed.'));
      }
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'career_ops_discord_shared', version: '1' },
      capabilities: { mcpServerOpenaiFormElicitation: true, experimentalApi: true },
    });
    this.write({ method: 'initialized', params: {} });
    return this.request('account/read', { refreshToken: false });
  }

  close() {
    this.socket.close();
  }
}

export function terminalArguments(runtime, threadId) {
  validateRuntime(runtime);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(threadId || ''))
    throw new Error('Missing saved lead thread. Wait for the Discord adapter to connect.');
  return [
    '--remote',
    runtime.endpoint,
    '--remote-auth-token-env',
    'CAREER_LEAD_RUNTIME_TOKEN',
    'resume',
    threadId,
    '--no-alt-screen',
  ];
}

export function terminalEnvironment(runtime, environment) {
  validateRuntime(runtime);
  return { ...codexEnvironment(environment), CAREER_LEAD_RUNTIME_TOKEN: runtime.token };
}

export async function applyAutomaticReview(rpc, threadId) {
  // Resume alone rejoins an already-loaded thread without applying its override parameters.
  await rpc.request('thread/settings/update', {
    threadId,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  });
  const recent = await rpc.request('thread/turns/list', {
    threadId,
    limit: 1,
    sortDirection: 'desc',
    itemsView: 'summary',
  });
  const activeTurn = recent.data?.find(turn => turn.status === 'inProgress')?.id;
  if (activeTurn)
    await rpc.request('turn/settings/update', {
      threadId,
      turnId: activeTurn,
      approvalsReviewer: 'auto_review',
    });
  return activeTurn;
}

export function reloadMcpServers(rpc) {
  return rpc.request('config/mcpServer/reload', null);
}

const base = join(root, 'logs/dev-discord-lead');
const runtimePath = join(base, 'runtime/runtime.json');
const readyPath = join(base, 'terminal-adapter.json');
const reloadPath = join(base, 'reload-discord.json');

async function connect(runtime) {
  const rpc = new SharedCodexRpc(runtime);
  try {
    await rpc.initialize();
    return rpc;
  } catch (error) {
    rpc.close();
    throw error;
  }
}

async function ensureRuntime(command) {
  if (existsSync(runtimePath)) {
    const saved = validateRuntime(JSON.parse(readFileSync(runtimePath, 'utf8')));
    try {
      const rpc = await connect(saved);
      rpc.close();
      throw Object.assign(
        new Error('A lead runtime is already running. Close its terminal before starting another.'),
        { code: 'LEAD_RUNNING' },
      );
    } catch (error) {
      if (error.code === 'LEAD_RUNNING') throw error;
      // A stopped runtime is replaced; the saved conversation remains resumable.
    }
  }
  const reserve = createServer();
  await new Promise((resolve, reject) => {
    reserve.once('error', reject);
    reserve.listen(0, '127.0.0.1', resolve);
  });
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const runtime = {
    version: 1,
    endpoint: `ws://127.0.0.1:${port}`,
    token: randomBytes(32).toString('hex'),
  };
  const log = openSync(join(base, 'runtime/host.log'), 'a');
  const host = spawn(
    command,
    [
      'app-server',
      '--listen',
      runtime.endpoint,
      '--ws-auth',
      'capability-token',
      '--ws-token-sha256',
      createHash('sha256').update(runtime.token).digest('hex'),
      '-c',
      'forced_login_method="chatgpt"',
      '-c',
      'developer_instructions=' +
        JSON.stringify(
          readFileSync(join(root, 'notes/dashboard-migration/DISCORD_LEAD_PROMPT.md'), 'utf8'),
        ),
      ...Object.entries(developmentConfig()).flatMap(([key, value]) => [
        '-c',
        `${key}=${JSON.stringify(value)}`,
      ]),
    ],
    {
      cwd: root,
      env: codexEnvironment(process.env),
      windowsHide: true,
      stdio: ['ignore', log, log],
    },
  );
  closeSync(log);
  host.on('error', () => {});
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (host.exitCode !== null)
        throw new Error('Local lead host exited. Inspect private runtime/host.log.');
      try {
        const rpc = await connect(runtime);
        rpc.close();
        writeFileSync(runtimePath + '.tmp', JSON.stringify(runtime) + '\n');
        renameSync(runtimePath + '.tmp', runtimePath);
        return { runtime, host };
      } catch {
        await delay(300);
      }
    }
    throw new Error('Local lead host did not become ready. Inspect private runtime/host.log.');
  } catch (error) {
    host.kill(); // Only the process this launcher just created, never a saved PID.
    throw error;
  }
}

async function main() {
  if (process.argv.includes('--reload-mcp')) {
    const runtime = validateRuntime(JSON.parse(readFileSync(runtimePath, 'utf8')));
    const rpc = await connect(runtime);
    try {
      await reloadMcpServers(rpc);
      console.log('Codex MCP configuration reload queued for loaded threads.');
    } finally {
      rpc.close();
    }
    return;
  }
  if (process.argv.includes('--reload')) {
    writeFileSync(reloadPath + '.tmp', JSON.stringify({ nonce: randomBytes(12).toString('hex') }));
    renameSync(reloadPath + '.tmp', reloadPath);
    console.log(
      'Discord adapter reload requested. The shared lead runtime and terminal stay running.',
    );
    return;
  }
  const config = JSON.parse(readFileSync(join(root, 'config/discord-lead.json'), 'utf8'));
  const command = process.env.CAREER_DISCORD_CODEX_COMMAND || config.codex_command;
  const { runtime, host } = await ensureRuntime(command);
  // The native foreground client handles Ctrl+C; the supervisor must survive its interrupt.
  const ignoreInterrupt = () => {};
  process.on('SIGINT', ignoreInterrupt);
  let adapter,
    terminal,
    reloading = false,
    closing = false;
  let lastReload = existsSync(reloadPath) ? readFileSync(reloadPath, 'utf8') : '';
  const startAdapter = async () => {
    if (closing) throw new Error('The terminal session has closed.');
    const out = openSync(join(base, 'adapter.log'), 'a');
    adapter = spawn(
      process.execPath,
      [join(root, 'src/helpers/discord-lead.mjs'), '--shared-runtime'],
      {
        cwd: root,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', out, out],
      },
    );
    closeSync(out);
    adapter.on('error', () => {});
    adapter.once('exit', () => {
      if (!closing && !reloading && terminal) {
        console.error(
          'Discord disconnected. Closing this lead so it cannot wait on inaccessible requests.',
        );
        terminal.kill();
      }
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (adapter.exitCode !== null)
        throw new Error('Discord adapter exited. Inspect logs/dev-discord-lead/adapter.log.');
      if (existsSync(readyPath)) {
        const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
        if (ready.pid === adapter.pid && ready.endpoint === runtime.endpoint) return ready.threadId;
      }
      await delay(300);
    }
    throw new Error('Discord adapter startup timed out. Inspect private adapter.log.');
  };
  try {
    const threadId = await startAdapter();
    console.log(
      'Opening the same lead in the native Codex terminal. /subagents shows specialist threads.',
    );
    console.log(
      'Routine actions use automatic review. Decisions arrive in your Discord DM; reply normally.',
    );
    console.log('To reload Discord from another terminal: Start-DiscordLead.ps1 -ReloadDiscord');
    console.log(
      'Exiting this terminal stops the lead host and Discord adapter. The conversation is saved.',
    );
    terminal = spawn(command, terminalArguments(runtime, threadId), {
      cwd: root,
      env: terminalEnvironment(runtime, process.env),
      stdio: 'inherit',
      windowsHide: false,
    });
    const watcher = setInterval(async () => {
      if (reloading || !existsSync(reloadPath)) return;
      const next = readFileSync(reloadPath, 'utf8');
      if (next === lastReload) return;
      reloading = true;
      lastReload = next;
      try {
        const oldAdapter = adapter;
        if (oldAdapter.exitCode === null && oldAdapter.signalCode === null) {
          const exited = new Promise(resolve => oldAdapter.once('exit', resolve));
          oldAdapter.kill('SIGTERM');
          await exited;
        }
        await startAdapter();
      } catch (error) {
        console.error(error.message);
        terminal?.kill();
      } finally {
        reloading = false;
      }
    }, 1000);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        terminal.once('error', reject);
        terminal.once('exit', code => resolve(code ?? 1));
      });
    } finally {
      clearInterval(watcher);
    }
  } finally {
    closing = true;
    process.off('SIGINT', ignoreInterrupt);
    adapter?.kill('SIGTERM');
    host.kill('SIGTERM');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
