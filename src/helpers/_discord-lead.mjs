// Development-only Discord/Codex transport. Application workers never import this file.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { root } from '../lib/root.mjs';

export const DEVELOPMENT_POLICY = Object.freeze({
  leadModel: 'gpt-6.1-sol',
  leadEffort: 'high',
  subagentModel: 'gpt-6-luna',
  subagentEffort: 'medium',
  approvalsReviewer: 'auto_review',
});

export function developmentConfig() {
  return {
    model: DEVELOPMENT_POLICY.leadModel,
    model_reasoning_effort: DEVELOPMENT_POLICY.leadEffort,
    approval_policy: 'on-request',
    approvals_reviewer: DEVELOPMENT_POLICY.approvalsReviewer,
    'mcp_servers.career_discord.command': process.execPath,
    'mcp_servers.career_discord.args': [join(root, 'src/helpers/discord-message.mjs'), '--mcp'],
    'auto_review.extra_policy':
      'Routine authorized development, local builds/tests and browser QA may proceed. Ask the owner through Discord when a decision is unclear. Require explicit approval of the exact action and target for irreversible destruction, production deployment, publishing private data, spending money or persistent security changes. Never submit a job application. A denied action must not be retried through a permission bypass.',
    'agents.default_subagent_model': DEVELOPMENT_POLICY.subagentModel,
    'agents.default_subagent_reasoning_effort': DEVELOPMENT_POLICY.subagentEffort,
  };
}

export function validateConfig(config) {
  if (!/^[0-9]{17,20}$/.test(config.owner_id || ''))
    throw new Error('Configure your numeric Discord owner_id locally.');
  if (
    typeof config.codex_command !== 'string' ||
    !config.codex_command.trim() ||
    /\.(cmd|bat|ps1)$/i.test(config.codex_command)
  )
    throw new Error('Configure a native Codex executable, not a shell script.');
  return config;
}

export function codexEnvironment(source) {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (/^(DISCORD.*TOKEN|CODEX_API_KEY|OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_.*)$/i.test(key))
      delete env[key];
  return env;
}

export function chunks(text, limit = 1900) {
  const result = [];
  let part = '';
  for (const char of String(text)) {
    if (part.length + char.length > limit) {
      result.push(part);
      part = '';
    }
    part += char;
  }
  if (part) result.push(part);
  return result;
}

export class Discord {
  constructor(token, fetcher = fetch) {
    if (!token || /\s/.test(token)) throw new Error('Discord bot token missing or malformed.');
    this.token = token;
    this.fetcher = fetcher;
    this.outgoing = Promise.resolve();
  }

  async api(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await this.fetcher('https://discord.com/api/v10' + path, {
        method,
        headers: {
          Authorization: 'Bot ' + this.token,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://discord.com/developers/docs, 1.0)',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429) {
        const data = await response.json();
        const seconds = Number(data.retry_after);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60)
          throw new Error('Discord rate limit: retry later.');
        await delay(Math.max(100, seconds * 1000));
        continue;
      }
      // Do not expose response bodies: they can contain credentials or private content.
      if (!response.ok) {
        const error = new Error(`Discord ${method} failed (HTTP ${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    }
    throw new Error('Discord is rate limited; retry later.');
  }

  send(channel, text, { silent = false } = {}) {
    const work = this.outgoing.then(async () => {
      const sent = [];
      for (const content of chunks(text))
        sent.push(
          await this.api('POST', `/channels/${channel}/messages`, {
            content,
            allowed_mentions: { parse: [] },
            flags: 4 | (silent ? 4096 : 0),
          }),
        );
      return sent;
    });
    this.outgoing = work.catch(() => {});
    return work;
  }
}

export class CodexRpc {
  constructor(
    command,
    cwd,
    { onEvent = () => {}, onRequest = () => {}, onExit = () => {}, spawnProcess = spawn } = {},
  ) {
    this.nextId = 0;
    this.pending = new Map();
    const policyArgs = Object.entries(developmentConfig()).flatMap(([key, value]) => [
      '-c',
      `${key}=${JSON.stringify(value)}`,
    ]);
    this.child = spawnProcess(
      command,
      ['app-server', '-c', 'forced_login_method="chatgpt"', ...policyArgs],
      {
        cwd,
        env: codexEnvironment(process.env),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child.stderr.resume(); // No raw stderr forwarded to Discord or logs.
    this.child.stdin.on('error', () => {});
    const fail = () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Codex app-server disconnected.'));
      }
      this.pending.clear();
      onExit();
    };
    this.child.on('error', fail);
    this.child.on('exit', fail);
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method) {
        if (message.id !== undefined) onRequest(message);
        else onEvent(message);
      } else if (this.pending.has(message.id)) {
        const item = this.pending.get(message.id);
        clearTimeout(item.timer);
        this.pending.delete(message.id);
        if (message.error) item.reject(new Error(`Codex RPC error (${message.error.code}).`));
        else item.resolve(message.result);
      }
    });
  }

  write(message) {
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out; do not blindly repeat the request.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: {
        name: 'career_ops_discord_lead',
        title: 'career-ops Discord lead',
        version: '1',
      },
      capabilities: { mcpServerOpenaiFormElicitation: true },
    });
    this.write({ method: 'initialized', params: {} });
    return this.request('account/read', { refreshToken: false });
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

export function conversationalApproval(text) {
  const answer = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, '')
    .trim();
  if (
    /^(ok(?:ay)?|yes(?: please)?|yep|yeah|sure|go ahead|do it|approved?|allow(?: it)?|sounds good)$/.test(
      answer,
    )
  )
    return true;
  if (
    /^(no(?: thanks)?|nope|deny|decline|reject|not now|don't|do not|cancel(?: it)?)$/.test(answer)
  )
    return false;
  return null;
}

// One queue for both native-terminal and headless requests. No tool-name allowlists.
export class RemoteDecisions {
  constructor(reply, send) {
    this.reply = reply;
    this.send = send;
    this.pending = new Map();
    this.delivery = Promise.resolve();
  }

  async add(request) {
    if (this.pending.has(request.id)) return;
    const p = request.params;
    let kind;
    if (
      [
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'execCommandApproval',
        'applyPatchApproval',
      ].includes(request.method)
    )
      kind = 'approval';
    else if (request.method === 'item/permissions/requestApproval') kind = 'permissions';
    else if (request.method === 'item/tool/requestUserInput' && p.questions?.length) kind = 'input';
    else if (request.method === 'mcpServer/elicitation/request') kind = 'elicitation';
    else
      throw new Error(
        `Unsupported Codex request: ${request.method}. The lead must reformulate it as a Discord question.`,
      );
    if (kind === 'input' && p.questions.some(q => q.isSecret))
      throw new Error(
        'Secret input requires a local secure prompt. Do not send secrets through Discord.',
      );
    const item = { request, kind, answers: {}, index: 0 };
    this.pending.set(request.id, item);
    await this.present();
  }

  present() {
    const work = this.delivery.then(async () => {
      if (this.current && this.pending.has(this.current.request.id)) return;
      this.current = this.pending.values().next().value;
      const item = this.current;
      if (!item) return;
      const p = item.request.params;
      let text;
      if (item.kind === 'input') {
        const q = p.questions[item.index];
        text = [
          q.question,
          ...(q.options || []).map(
            (o, i) => `${i + 1}. ${o.label}${o.description ? ': ' + o.description : ''}`,
          ),
          'Reply with your answer.',
        ].join('\n');
      } else {
        const review = Object.fromEntries(
          Object.entries(p).filter(
            ([key]) =>
              !['threadId', 'conversationId', 'turnId', 'itemId', 'startedAtMs'].includes(key),
          ),
        );
        // Escape backticks so tool-controlled text cannot close the review block.
        text =
          '**Your decision needed**\n' + JSON.stringify(review, null, 2).replace(/`/g, '\\u0060');
        const schema = p.requestedSchema;
        const form =
          item.kind === 'elicitation' && schema && Object.keys(schema.properties || {}).length;
        text += form
          ? '\nReply with a JSON object containing your answers, or no to decline. For a single field, plain text is enough.'
          : '\nReply ok to allow this request once, or no to decline. No permanent permission is granted.';
      }
      const sent = await this.send(text);
      if (this.current === item) item.messageId = sent.at(-1)?.id;
    });
    this.delivery = work.catch(() => {
      this.current = undefined;
    });
    return work;
  }

  async answer(text, messageId, replyTo) {
    const item = this.current;
    if (!item || !item.messageId || BigInt(messageId) <= BigInt(item.messageId)) return false;
    if (replyTo && replyTo !== item.messageId) return false;
    const { request, kind } = item;
    const p = request.params;
    const allowed = conversationalApproval(text);
    let result;
    if (kind === 'input') {
      const q = p.questions[item.index];
      const option = /^\d+$/.test(text) ? q.options?.[Number(text) - 1] : undefined;
      item.answers[q.id] = { answers: [option?.label || text] };
      item.index++;
      if (item.index < p.questions.length) {
        this.current = undefined;
        await this.present();
        return true;
      }
      result = { answers: item.answers };
    } else if (kind === 'elicitation') {
      const schema = p.requestedSchema;
      const fields = Object.keys(schema?.properties || {});
      if (allowed === false) result = { action: 'decline', content: null };
      else if (!fields.length && allowed === true)
        result = { action: 'accept', content: schema ? {} : null };
      else if (fields.length) {
        let content;
        try {
          content = JSON.parse(text);
        } catch {
          if (fields.length === 1) content = { [fields[0]]: text };
        }
        if (
          !content ||
          typeof content !== 'object' ||
          Array.isArray(content) ||
          (schema.required || []).some(key => !(key in content))
        ) {
          await this.send(
            'Please answer the form with a JSON object containing its required fields, or reply no.',
          );
          return true;
        }
        result = { action: 'accept', content };
      } else return false;
    } else {
      if (allowed === null) return false;
      if (kind === 'permissions')
        result = {
          permissions: allowed ? p.permissions : {},
          scope: 'turn',
          strictAutoReview: true,
        };
      else {
        if (allowed && p.availableDecisions && !p.availableDecisions.includes('accept')) {
          await this.send(
            'Codex does not offer one-time acceptance for this request. Reply no, or ask the lead for another approach.',
          );
          return true;
        }
        const legacy = ['execCommandApproval', 'applyPatchApproval'].includes(request.method);
        result = {
          decision: legacy ? (allowed ? 'approved' : 'denied') : allowed ? 'accept' : 'decline',
        };
      }
    }
    this.reply({ id: request.id, result });
    this.pending.delete(request.id);
    this.current = undefined;
    await this.present();
    return true;
  }

  async resolve(threadId, requestId) {
    const item = this.pending.get(requestId);
    if (item && (item.request.params.threadId || item.request.params.conversationId) === threadId) {
      this.pending.delete(requestId);
      if (this.current === item) this.current = undefined;
      await this.present();
    }
  }

  async clearTurn(threadId, turnId) {
    for (const [id, item] of this.pending)
      if (
        (item.request.params.threadId || item.request.params.conversationId) === threadId &&
        item.request.params.turnId === turnId
      ) {
        this.pending.delete(id);
        if (this.current === item) this.current = undefined;
      }
    await this.present();
  }
}
