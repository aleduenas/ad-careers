// Shared isolated-CLI runtime used by CV/letter drafting and evaluation.
// Provider processes run as subscription logins only (no API keys), with
// session persistence, slash commands and project MCP loading disabled.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, delimiter, extname } from 'node:path';
import { renderPrompt } from './_prompt-templates.mjs';
import { root as promptRoot } from './root.mjs';
import { recordCallSafe } from './_llm-usage.mjs';

export function childOf(base, path) {
  const r = relative(base, path);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
}
export function draftingRoot(root, configured) {
  const target = resolve(root, configured),
    repo = realpathSync(root);
  if (!childOf(join(repo, 'logs'), target))
    throw new Error('Drafting archive must be below repository logs');
  let existing = target;
  while (!existsSync(existing)) existing = resolve(existing, '..');
  if (realpathSync(existing) !== repo && !childOf(repo, realpathSync(existing)))
    throw new Error('Drafting archive escapes repository through a link');
  return target;
}
export async function temporaryWorker(root, action) {
  const target = draftingRoot(root, 'logs/workers');
  mkdirSync(target, { recursive: true });
  const base = realpathSync(target);
  const work = mkdtempSync(join(base, 'career-cv-worker-'));
  try {
    return await action(work);
  } finally {
    if (
      !childOf(base, work) ||
      resolve(work, '..') !== base ||
      !work.startsWith(join(base, 'career-cv-worker-'))
    )
      throw new Error('Unsafe temporary cleanup');
    rmSync(work, { recursive: true, force: true });
  }
}
export function subscriptionEnv(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (
      /^(OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_.*|CLAUDECODE|FIRECRAWL_API_KEY)$/i.test(
        key,
      )
    )
      delete env[key];
  return env;
}
export function cliSpec(provider, config, lastMessage, { research = false } = {}) {
  if (provider === 'codex' && (!config.codex_model || !config.codex_model.trim()))
    throw new Error(
      'Set an explicit codex_model in config/cv-drafting.json; CLI default selection is disabled',
    );
  if (provider === 'claude')
    return {
      command: config.claude_command,
      args: [
        '-p',
        '--safe-mode',
        '--output-format',
        'json',
        '--model',
        config.claude_model,
        ...(config.claude_effort ? ['--effort', config.claude_effort] : []),
        '--tools',
        research ? 'WebSearch,WebFetch' : '',
        ...(research ? ['--allowedTools', 'WebSearch,WebFetch'] : []),
        '--permission-mode',
        'dontAsk',
        '--disable-slash-commands',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--system-prompt',
        renderPrompt(
          promptRoot,
          research ? 'runtime/research.md' : 'runtime/no-tools.md',
        ).trimEnd(),
      ],
    };
  if (provider === 'codex')
    return {
      command: config.codex_command,
      args: [
        'exec',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '-c',
        'forced_login_method="chatgpt"',
        '-c',
        'project_doc_max_bytes=0',
        '-c',
        'features.shell_tool=false',
        '-c',
        'features.unified_exec=false',
        '-c',
        'web_search="' + (research ? 'live' : 'disabled') + '"',
        '--color',
        'never',
        '--output-last-message',
        lastMessage,
        ...(config.codex_model ? ['--model', config.codex_model] : []),
        '-',
      ],
    };
  throw new Error('Provider must be claude or codex');
}
// Windows command resolution. Node refuses to start .cmd/.bat files without a shell, and npm
// global installs (for example codex) are .cmd shims with no .exe on PATH. resolveCommand turns a
// command name and its arguments into a spawn plan: on win32 a bare name is searched on PATH
// (.exe and .com before .cmd and .bat); a .cmd/.bat match runs through cmd.exe with a carefully
// quoted command line, anything else is spawned directly. Other platforms are unchanged.
const SEPARATOR = /[\\/]/;
const CMD_CHARS = /[\r\n\0%&|<>^]/;

export function quoteCmdArgument(value) {
  const text = String(value);
  if (/[\r\n\0]/.test(text)) throw new Error('Command argument must not contain a line break');
  if (CMD_CHARS.test(text)) throw new Error('Command argument contains a character cmd.exe reads');
  // CommandLineToArgvW rules: backslashes before a quote are doubled, the quote is escaped.
  return '"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

export function resolveCommand(
  name,
  args = [],
  { platform = process.platform, env = process.env, exists = existsSync } = {},
) {
  const direct = { command: name, args, windowsVerbatimArguments: false, resolved: null };
  if (platform !== 'win32' || typeof name !== 'string' || !name) return direct;
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  const extensions = (env.PATHEXT || env.pathext || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const rank = ext => (ext === '.exe' || ext === '.com' ? 0 : 1);
  const ordered = [...extensions].sort((a, b) => rank(a) - rank(b));
  let found = null;
  if (SEPARATOR.test(name)) found = name;
  else {
    const dirs = String((pathKey && env[pathKey]) || '')
      .split(delimiter)
      .map(item => item.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
    const known = extensions.includes(extname(name).toLowerCase());
    const candidates = [];
    for (const group of [0, 1])
      for (const dir of dirs) {
        if (known && rank(extname(name).toLowerCase()) === group) candidates.push(join(dir, name));
        for (const ext of ordered) if (rank(ext) === group) candidates.push(join(dir, name + ext));
      }
    found = candidates.find(candidate => exists(candidate)) ?? null;
  }
  if (!found) return direct;
  if (!/\.(cmd|bat)$/i.test(found)) return { ...direct, command: found, resolved: found };
  const line = [quoteCmdArgument(found), ...args.map(quoteCmdArgument)].join(' ');
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', '"' + line + '"'],
    windowsVerbatimArguments: true,
    resolved: found,
  };
}

export async function processRun(
  command,
  args,
  { cwd, input = '', timeout = 600000, env = subscriptionEnv(), usage = null } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const plan = resolveCommand(command, args, { env });
    const child = spawn(plan.command, plan.args, {
      cwd,
      env,
      shell: false,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const startedAt = Date.now();
    let stdout = '',
      stderr = '',
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid)
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 3000,
        });
      child.kill('SIGKILL');
    }, timeout);
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdout.on('data', b => {
      stdout += b;
      if (stdout.length > 4e6) child.kill();
    });
    child.stderr.on('data', b => {
      stderr += b;
      if (stderr.length > 4e6) child.kill();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', async code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('CLI timed out; worker stopped'));
      const result = { code, stdout, stderr };
      // Accounting for launcher LLM calls: only when the caller names the call (see _llm-usage.mjs).
      if (usage)
        await recordCallSafe(usage, result, Date.now() - startedAt, { query: usage.query });
      resolvePromise(result);
    });
  });
}
export async function checkLogin(provider, config, cwd) {
  const r = await processRun(
    provider === 'claude' ? config.claude_command : config.codex_command,
    provider === 'claude' ? ['auth', 'status'] : ['login', 'status'],
    { cwd, timeout: 30000 },
  );
  if (provider === 'claude') {
    let status;
    try {
      status = JSON.parse(r.stdout);
    } catch {
      throw new Error('Cannot read Claude login status. Run claude auth login.');
    }
    if (r.code !== 0 || !status.loggedIn || status.authMethod !== 'claude.ai')
      throw new Error(
        'Claude subscription login required. Run claude auth login; API billing is not used.',
      );
  } else if (r.code !== 0 || !/using ChatGPT/i.test(r.stdout + r.stderr))
    throw new Error('ChatGPT login required. Run codex login; API billing is not used.');
  return { provider, subscription_login: true };
}
