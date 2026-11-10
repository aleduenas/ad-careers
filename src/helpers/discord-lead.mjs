#!/usr/bin/env node
// One Codex session, two input routes. Progress goes to the channel; decisions go to the owner DM.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../lib/root.mjs';
import {
  validateConfig,
  CodexRpc,
  Discord,
  RemoteDecisions,
  conversationalApproval,
  DEVELOPMENT_POLICY,
  developmentConfig,
} from './_discord-lead.mjs';
import { SharedCodexRpc, validateRuntime, applyAutomaticReview } from './discord-terminal.mjs';
import {
  StatusBoard,
  channelPermissions,
  channelTextEnabled,
  resolveProjectChannel,
  trustedProjectMessage,
} from './_discord-channel.mjs';
import { readAttention, sendOwnerDm, loadDiscordToken } from './discord-message.mjs';

const base = join(root, 'logs/dev-discord-lead');
const configPath = join(root, 'config/discord-lead.json');
const statePath = join(base, 'session.json');
const lockPath = join(base, 'bridge.lock');
const promptPath = join(root, 'documentation/dashboard-migration/DISCORD_LEAD_PROMPT.md');

export class LeadBridge {
  constructor({
    rpc,
    discord,
    channel,
    dm,
    threadId,
    topic,
    onThreadChange = () => {},
    log = () => {},
  }) {
    Object.assign(this, { rpc, discord, channel, dm, threadId, topic, log });
    this.onThreadChange = onThreadChange;
    this.trustedThreads = new Set(threadId ? [threadId] : []);
    this.finishedTurns = new Set();
    this.completedItems = new Set();
    this.resolvedRequests = new Set();
    this.endedTurns = new Set();
    this.decisions = new RemoteDecisions(
      message => rpc.write(message),
      text => discord.send(dm, text),
    );
    this.lastUpdate = 'No updates yet.';
  }

  async refreshTopic() {
    try {
      const state = readAttention();
      await this.topic?.update(state.actions + this.decisions.pending.size, state.blockers, {
        actions: [
          ...(state.action_details.length
            ? state.action_details
            : state.actions
              ? [`${state.actions} owner decision(s); details not yet supplied by the lead.`]
              : []),
          ...(this.decisions.pending.size
            ? [
                `${this.decisions.pending.size} native tool approval/question(s): respond in the bot DM.`,
              ]
            : []),
        ],
        blockers: state.blocker_details,
      });
    } catch {
      console.error('Discord attention counts could not be read. Messages and approvals continue.');
    }
  }

  async progress(text) {
    this.lastUpdate = text;
    this.log({ kind: 'update', text });
    // Terminal prose is local. Only the explicit post_update tool publishes to the channel.
  }

  async event({ method, params: p }) {
    // Native /clear creates a new user thread on this dedicated host.
    if (
      method === 'thread/started' &&
      p.thread?.threadSource === 'user' &&
      !p.thread.parentThreadId &&
      !p.thread.forkedFromId &&
      p.thread.cwd === root
    ) {
      this.threadId = p.thread.id;
      this.activeTurn = undefined;
      this.lastUpdate = 'New chat opened in the terminal.';
      this.trustedThreads.add(this.threadId);
      this.onThreadChange(this.threadId);
    }
    if (method === 'serverRequest/resolved')
      this.resolvedRequests.add(JSON.stringify([p.threadId, p.requestId]));
    if (method === 'turn/completed') this.endedTurns.add(JSON.stringify([p.threadId, p.turn.id]));
    for (const seen of [this.resolvedRequests, this.endedTurns])
      if (seen.size > 1000) seen.delete(seen.values().next().value);
    if (method === 'thread/started' && this.trustedThreads.has(p.thread?.parentThreadId))
      this.trustedThreads.add(p.thread.id);
    if (!this.trustedThreads.has(p?.threadId)) return;
    if (method === 'serverRequest/resolved') await this.decisions.resolve(p.threadId, p.requestId);
    if (method === 'turn/completed') await this.decisions.clearTurn(p.threadId, p.turn.id);
    if (p.threadId !== this.threadId) return;
    if (method === 'turn/started') this.activeTurn = p.turn.id;
    if (method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.text) {
      const key = JSON.stringify([p.turnId, p.item.id]);
      if (p.item.id && this.completedItems.has(key)) return;
      this.completedItems.add(key);
      if (this.completedItems.size > 1000)
        this.completedItems.delete(this.completedItems.values().next().value);
      await this.progress(p.item.text);
    }
    if (method === 'turn/completed') {
      this.finishedTurns.add(p.turn.id);
      if (this.finishedTurns.size > 100)
        this.finishedTurns.delete(this.finishedTurns.values().next().value);
      if (this.activeTurn === p.turn.id) this.activeTurn = undefined;
      if (!['completed', 'interrupted'].includes(p.turn.status))
        await this.discord.send(
          this.dm,
          `The lead stopped with status ${p.turn.status}. Send a follow-up here; completed changes are retained.`,
        );
    }
    void this.refreshTopic();
  }

  async request(message) {
    const p = message.params;
    const thread = p?.threadId || p?.conversationId;
    if (!thread) throw new Error('Codex sent a request without a session identity.');
    if (!this.trustedThreads.has(thread)) {
      const related = await this.rpc.request('thread/read', { threadId: thread });
      if (
        related.thread?.sessionId !== this.threadId &&
        !this.trustedThreads.has(related.thread?.parentThreadId)
      )
        return;
      this.trustedThreads.add(thread);
    }
    if (
      this.resolvedRequests.has(JSON.stringify([thread, message.id])) ||
      this.endedTurns.has(JSON.stringify([thread, p.turnId]))
    )
      return;
    await this.decisions.add(message);
    void this.refreshTopic();
  }

  async requestFailed(message, error) {
    const thread = message.params?.threadId || message.params?.conversationId;
    if (this.resolvedRequests.has(JSON.stringify([thread, message.id]))) return;
    // A failure never leaves a hidden terminal-only request waiting indefinitely.
    const method = message.method;
    const result =
      method === 'mcpServer/elicitation/request'
        ? { action: 'decline', content: null }
        : method === 'item/permissions/requestApproval'
          ? { permissions: {}, scope: 'turn' }
          : ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
                method,
              )
            ? { decision: 'decline' }
            : ['execCommandApproval', 'applyPatchApproval'].includes(method)
              ? { decision: 'denied' }
              : undefined;
    this.rpc.write(
      result
        ? { id: message.id, result }
        : {
            id: message.id,
            error: {
              code: -32603,
              message:
                'Ask the owner through a normal Discord message instead. This request was not approved.',
            },
          },
    );
    this.decisions.pending.delete(message.id);
    if (this.decisions.current?.request.id === message.id) this.decisions.current = undefined;
    await this.discord.send(
      this.dm,
      `A Codex request could not be relayed and was declined. ${error.message} No action was approved. You can reply here.`,
    );
    await this.decisions.present();
    void this.refreshTopic();
  }

  async message(text, messageId, source, replyTo) {
    const isDm = source === this.dm;
    const respond = answer => this.discord.send(source, answer);
    if (isDm && (await this.decisions.answer(text, messageId, replyTo))) {
      void this.refreshTopic();
      return;
    }
    if (isDm && this.decisions.pending.size && conversationalApproval(text) !== null)
      return respond(
        'That reply does not match the current approval DM. Reply to the latest question; nothing was approved.',
      );
    if (text === '!help')
      return respond(
        'Send text here to talk to the lead. Reply ok/no to the current approval DM. !status shows progress; !stop interrupts work.',
      );
    if (text === '!status')
      return respond(
        `${this.activeTurn ? 'Working' : 'Idle'} | ${this.decisions.pending.size} tool decisions pending\n${this.lastUpdate}`,
      );
    if (text === '!stop') {
      if (this.activeTurn)
        await this.rpc.request('turn/interrupt', {
          threadId: this.threadId,
          turnId: this.activeTurn,
        });
      return respond('Interrupt requested. Completed actions are retained.');
    }
    const input = [
      {
        type: 'text',
        text: isDm
          ? '[Owner Discord DM. Answer promptly using the career_discord send_dm tool. Use post_update only for work progress, never this direct reply.]\n' +
            text
          : text,
      },
    ];
    this.log({ kind: 'owner', source: isDm ? 'dm' : 'channel', text });
    if (this.activeTurn) {
      await this.rpc.request('turn/steer', {
        threadId: this.threadId,
        expectedTurnId: this.activeTurn,
        input,
        clientUserMessageId: messageId,
      });
    } else {
      const result = await this.rpc.request('turn/start', {
        threadId: this.threadId,
        input,
        clientUserMessageId: messageId,
        model: DEVELOPMENT_POLICY.leadModel,
        effort: DEVELOPMENT_POLICY.leadEffort,
        approvalPolicy: 'on-request',
        approvalsReviewer: DEVELOPMENT_POLICY.approvalsReviewer,
      });
      if (!this.finishedTurns.has(result.turn.id)) this.activeTurn = result.turn.id;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const route = args.find(arg => arg.startsWith('--project-channel='));
  if (
    args.some(
      arg =>
        ![
          '--check',
          '--dry-run',
          '--test-dm',
          '--test-channel',
          '--shared-runtime',
          '--apply',
        ].includes(arg) && arg !== route,
    )
  )
    throw new Error('Unknown bridge argument.');
  const check = args.includes('--check') || args.includes('--dry-run');
  const shared = args.includes('--shared-runtime');
  const configured = existsSync(configPath);
  if (!configured && !check) throw new Error('Run Start-DiscordLead.ps1 -Configure locally first.');
  const config = configured
    ? validateConfig(JSON.parse(readFileSync(configPath, 'utf8')))
    : { codex_command: 'codex' };
  if (process.env.CAREER_DISCORD_CODEX_COMMAND)
    config.codex_command = process.env.CAREER_DISCORD_CODEX_COMMAND;
  mkdirSync(base, { recursive: true });
  let rpc,
    ownsLock = false,
    running = true,
    bridge;
  const jobs = new Set();
  const track = promise => {
    jobs.add(promise);
    promise
      .catch(error => {
        console.error(error.message);
        running = false;
      })
      .finally(() => jobs.delete(promise));
  };
  const stop = () => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (!check && !route && !args.includes('--test-dm') && !args.includes('--test-channel')) {
      if (existsSync(lockPath)) {
        const pid = Number(readFileSync(lockPath, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid bridge lock.');
        try {
          process.kill(pid, 0);
          throw new Error('A Discord bridge is already running.');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        unlinkSync(lockPath);
      }
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      ownsLock = true;
    }
    const token = check ? process.env.DISCORD_LEAD_BOT_TOKEN : loadDiscordToken();
    if (route) {
      const discord = new Discord(token);
      const resolved = await resolveProjectChannel(
        discord,
        route.slice('--project-channel='.length),
      );
      console.log('Project channel preview: ' + JSON.stringify(resolved));
      console.log(
        'Missing permissions: ' +
          (await channelPermissions(discord, resolved.project_channel_id)).join(', '),
      );
      if (args.includes('--apply')) {
        writeFileSync(
          configPath + '.tmp',
          JSON.stringify({ ...config, ...resolved }, null, 2) + '\n',
        );
        renameSync(configPath + '.tmp', configPath);
      } else console.log('Dry run only. Use --apply to save.');
      return;
    }
    const deferred = [];
    const options = {
      onEvent: event => {
        if (bridge) track(bridge.event(event));
      },
      onRequest: message => {
        if (!bridge) {
          deferred.push(message);
          return;
        }
        track(bridge.request(message).catch(error => bridge.requestFailed(message, error)));
      },
      onExit: () => {
        running = false;
        if (bridge)
          track(
            bridge.discord.send(
              bridge.dm,
              'The lead disconnected. Its completed work is saved. The local runtime must reconnect before I can accept more instructions.',
            ),
          );
      },
    };
    rpc = shared
      ? new SharedCodexRpc(
          validateRuntime(JSON.parse(readFileSync(join(base, 'runtime/runtime.json'), 'utf8'))),
          options,
        )
      : new CodexRpc(config.codex_command, root, options);
    const account = await rpc.initialize();
    const authenticated = account.account?.type === 'chatgpt';
    const hasRoute =
      /^\d{17,20}$/.test(config.project_channel_id || '') &&
      /^\d{17,20}$/.test(config.project_guild_id || '');
    console.log(
      `Codex subscription login: ${authenticated ? 'ready' : 'missing'}. Discord configuration: ${configured ? 'valid' : 'missing'}. Token supplied: ${Boolean(token)}. Project channel configured: ${hasRoute}.`,
    );
    if (check) {
      if (!authenticated || !configured || !token || !hasRoute) process.exitCode = 1;
      return;
    }
    if (!authenticated)
      throw new Error('Sign in locally with codex login using your ChatGPT subscription.');
    const discord = new Discord(token);
    if (args.includes('--test-dm')) {
      await sendOwnerDm(
        discord,
        config,
        'career-ops Discord transport test: owner DM delivery confirmed. No project work started.',
      );
      console.log('Discord confirmed test DM delivery.');
      return;
    }
    if (!hasRoute) throw new Error('Configure the project channel first.');
    const project = await discord.api('GET', `/channels/${config.project_channel_id}`);
    if (project.type !== 0 || project.guild_id !== config.project_guild_id)
      throw new Error('Configured channel/server does not match Discord.');
    const missing = await channelPermissions(discord, project.id);
    if (missing.length) throw new Error('Missing channel permissions: ' + missing.join(', '));
    if (!(await channelTextEnabled(discord)))
      throw new Error('Enable Message Content Intent for channel input.');
    if (args.includes('--test-channel')) {
      await discord.send(
        project.id,
        'career-ops channel transport test: progress delivery confirmed. No project work started.',
        { silent: true },
      );
      console.log('Discord confirmed test channel delivery.');
      return;
    }
    const dm = await discord.api('POST', '/users/@me/channels', { recipient_id: config.owner_id });
    if (dm.type !== 1 || dm.recipients?.length !== 1 || dm.recipients[0].id !== config.owner_id)
      throw new Error('Discord did not return the owner DM.');
    // Start cursors before resuming so messages received during initialization are retained.
    const sources = [dm.id, project.id];
    const cursors = new Map();
    for (const source of sources) {
      const latest = await discord.api('GET', `/channels/${source}/messages?limit=1`);
      cursors.set(source, latest[0]?.id || String((BigInt(Date.now()) - 1420070400000n) << 22n));
    }
    const saved = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
    const params = {
      cwd: root,
      model: DEVELOPMENT_POLICY.leadModel,
      config: developmentConfig(),
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: DEVELOPMENT_POLICY.approvalsReviewer,
      developerInstructions: readFileSync(promptPath, 'utf8'),
    };
    const started = await rpc.request(
      saved.thread_id ? 'thread/resume' : 'thread/start',
      saved.thread_id ? { ...params, threadId: saved.thread_id, excludeTurns: true } : params,
    );
    const threadId = started.thread.id;
    const instructions = readFileSync(promptPath, 'utf8');
    const instructionsHash = createHash('sha256').update(instructions).digest('hex');
    if (saved.instructions_hash !== instructionsHash) {
      // Resumed history can contain retired developer instructions. Supersede them explicitly,
      // without starting a model turn or authorizing project work.
      await rpc.request('thread/inject_items', {
        threadId,
        items: [
          {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: instructions }],
          },
        ],
      });
      saved.instructions_hash = instructionsHash;
    }
    const saveThread = threadId => {
      writeFileSync(
        statePath + '.tmp',
        JSON.stringify({ ...saved, thread_id: threadId }, null, 2) + '\n',
      );
      renameSync(statePath + '.tmp', statePath);
      if (shared) {
        const runtime = JSON.parse(readFileSync(join(base, 'runtime/runtime.json'), 'utf8'));
        const readyPath = join(base, 'terminal-adapter.json');
        writeFileSync(
          readyPath + '.tmp',
          JSON.stringify({ pid: process.pid, threadId, endpoint: runtime.endpoint }),
        );
        renameSync(readyPath + '.tmp', readyPath);
      }
    };
    bridge = new LeadBridge({
      rpc,
      discord,
      channel: project.id,
      dm: dm.id,
      threadId,
      topic: new StatusBoard(discord, project.id, project.guild_id, {
        saved: existsSync(join(base, 'status-board.json'))
          ? JSON.parse(readFileSync(join(base, 'status-board.json'), 'utf8'))
          : existsSync(join(base, 'channel-state.json'))
            ? (() => {
                const old = JSON.parse(readFileSync(join(base, 'channel-state.json'), 'utf8'));
                return { channel: old.channel, messageId: old.pins?.[0] };
              })()
            : {},
        save: state => {
          writeFileSync(join(base, 'status-board.json.tmp'), JSON.stringify(state) + '\n');
          renameSync(join(base, 'status-board.json.tmp'), join(base, 'status-board.json'));
        },
      }),
      onThreadChange: saveThread,
      log: entry =>
        appendFileSync(
          join(base, 'messages.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), threadId: bridge.threadId, ...entry }) +
            '\n',
        ),
    });
    bridge.activeTurn = shared
      ? await applyAutomaticReview(rpc, threadId)
      : started.thread.turns?.find(t => t.status === 'inProgress')?.id;
    saveThread(threadId);
    for (const message of deferred)
      await bridge.request(message).catch(error => bridge.requestFailed(message, error));
    console.log(
      'Discord bridge connected. Routine progress goes to the channel; decisions and important messages go to your DM.',
    );
    while (running) {
      track(bridge.refreshTopic());
      const pages = await Promise.all(
        sources.map(source =>
          discord.api('GET', `/channels/${source}/messages?after=${cursors.get(source)}&limit=100`),
        ),
      );
      const batch = pages.flat().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const item of batch) {
        if (!running) break;
        cursors.set(item.channel_id, item.id);
        if (
          !trustedProjectMessage(item, config.owner_id, dm.id, project.id, config.project_guild_id)
        )
          continue;
        if (item.attachments?.length || !item.content.trim()) {
          await discord.send(item.channel_id, 'Send text only; attachments are not forwarded.');
          continue;
        }
        try {
          await bridge.message(
            item.content.trim(),
            item.id,
            item.channel_id,
            item.message_reference?.message_id,
          );
        } catch (error) {
          await discord.send(
            dm.id,
            `Your instruction was not accepted: ${error.message} Please resend after checking !status.`,
          );
        }
      }
      // Drain full pages immediately rather than discarding a backlog.
      if (!pages.some(page => page.length === 100)) await delay(3000);
    }
  } finally {
    await Promise.allSettled([...jobs]);
    rpc?.close();
    if (ownsLock) unlinkSync(lockPath);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
