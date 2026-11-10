#!/usr/bin/env node
// A real owner-only send action for the lead; no prose markers or credentials in prompts.
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from '../lib/root.mjs';
import { Discord, validateConfig } from './_discord-lead.mjs';
import { StatusBoard } from './_discord-channel.mjs';

export const attentionPath = join(root, 'logs/dev-discord-lead/attention.json');
const statusBoardPath = join(root, 'logs/dev-discord-lead/status-board.json');

// Edit the one standing pinned message and the channel topic from the saved attention lists.
// The lead's set_attention call is the only writer; no bridge process is needed any more.
export async function refreshStatusBoard(discord, config, state = readAttention()) {
  if (!/^[0-9]{17,20}$/.test(config.project_channel_id || '')) return { board_updated: false };
  const saved = existsSync(statusBoardPath)
    ? JSON.parse(readFileSync(statusBoardPath, 'utf8'))
    : {};
  const board = new StatusBoard(discord, config.project_channel_id, config.project_guild_id, {
    saved,
    save: value => {
      writeFileSync(statusBoardPath + '.tmp', JSON.stringify(value) + '\n');
      renameSync(statusBoardPath + '.tmp', statusBoardPath);
    },
    report: message => {
      throw new Error(message);
    },
  });
  await board.update(state.actions, state.blockers, {
    actions: state.action_details,
    blockers: state.blocker_details,
  });
  return { board_updated: true, message_id: board.messageId };
}

export function readAttention() {
  const state = existsSync(attentionPath) ? JSON.parse(readFileSync(attentionPath, 'utf8')) : {};
  return {
    actions: Array.isArray(state.actions) ? state.actions.length : state.actions || 0,
    blockers: Array.isArray(state.blockers) ? state.blockers.length : state.blockers || 0,
    action_details: Array.isArray(state.actions) ? state.actions : state.action_details || [],
    blocker_details: Array.isArray(state.blockers) ? state.blockers : state.blocker_details || [],
  };
}

export function loadDiscordToken() {
  if (process.env.DISCORD_LEAD_BOT_TOKEN) return process.env.DISCORD_LEAD_BOT_TOKEN;
  // DPAPI decryption stays inside the helper. Never print this output or its exception details.
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        String.raw`
      $ErrorActionPreference = 'Stop'
      $secret = ConvertTo-SecureString -String ([IO.File]::ReadAllText($env:CAREER_DISCORD_TOKEN_FILE))
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
      try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secret.Dispose() }
    `,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          CAREER_DISCORD_TOKEN_FILE: join(root, 'config/discord-lead-token.dpapi'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    throw new Error(
      'Cannot unlock the local Discord token. Run as the Windows account that configured the bridge.',
    );
  }
}

export function messageOptions(args) {
  const options = { send: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--send') options.send = true;
    else if (arg === '--dry-run') options.send = false;
    else if (arg === '--dm') {
      options.text = args[++i];
      if (!options.text?.trim() || options.text.length > 20000)
        throw new Error('--dm needs 1–20000 characters.');
    } else if (/^--(actions|blockers)=\d+$/.test(arg)) {
      const [key, value] = arg.slice(2).split('=');
      options[key] = Number(value);
      if (!Number.isSafeInteger(options[key])) throw new Error('Invalid attention count.');
    } else throw new Error('Use --dm TEXT and/or --actions=N --blockers=N; add --send to apply.');
  }
  if (options.text === undefined && options.actions === undefined && options.blockers === undefined)
    throw new Error('Provide --dm TEXT and/or --actions=N --blockers=N.');
  return options;
}

export async function sendOwnerDm(discord, config, text) {
  const dm = await discord.api('POST', '/users/@me/channels', { recipient_id: config.owner_id });
  if (dm.type !== 1 || dm.recipients?.length !== 1 || dm.recipients[0].id !== config.owner_id)
    throw new Error('Discord did not return the configured owner-only DM.');
  return discord.send(dm.id, text);
}

export const discordTools = [
  {
    name: 'send_dm',
    description:
      'Send a direct message to the configured owner. The text is sent exactly as supplied. Use for conversation, decisions and important notices; never wrap a DM as a channel update.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 20000 } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_update',
    description:
      'Post a concise work-progress update to the configured project channel. Do not use for direct replies or requested DMs.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 20000 } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_attention',
    description:
      'Replace the current action and blocker lists in the standing pinned message. Pass arrays of concise descriptions; use [] when clear. The topic shows counts and a link. Native approvals are added automatically. Integer counts are accepted only for legacy callers.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          anyOf: [
            { type: 'array', items: { type: 'string', minLength: 1 } },
            { type: 'integer', minimum: 0 },
          ],
        },
        blockers: {
          anyOf: [
            { type: 'array', items: { type: 'string', minLength: 1 } },
            { type: 'integer', minimum: 0 },
          ],
        },
      },
      required: ['actions', 'blockers'],
      additionalProperties: false,
    },
  },
];

export async function callDiscordTool(
  name,
  args,
  { config, discord, saveAttention, updateBoard } = {},
) {
  const tool = discordTools.find(tool => tool.name === name);
  if (
    !tool ||
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some(key => !(key in tool.inputSchema.properties)) ||
    tool.inputSchema.required.some(key => !(key in args))
  )
    throw new Error('Invalid Discord tool or arguments.');
  if (name === 'set_attention') {
    if (
      ![args.actions, args.blockers].every(value =>
        Array.isArray(value)
          ? value.every(text => typeof text === 'string' && text.trim())
          : Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new Error(
        'Attention lists must contain descriptions, or legacy nonnegative integer counts.',
      );
    if (JSON.stringify(args).length > 1700)
      throw new Error('Summarize the action/blocker lists within 1700 characters.');
    saveAttention(args);
    const board = updateBoard ? await updateBoard(args) : {};
    return { attention_saved: true, ...board };
  }
  if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 20000)
    throw new Error('Message text must contain 1–20000 characters.');
  const sent =
    name === 'send_dm'
      ? await sendOwnerDm(discord, config, args.text)
      : await discord.send(config.project_channel_id, args.text, { silent: true });
  return {
    destination: name === 'send_dm' ? 'owner' : 'channel',
    message_ids: sent.map(item => item.id),
  };
}

export function saveAttention(state) {
  mkdirSync(join(root, 'logs/dev-discord-lead'), { recursive: true });
  writeFileSync(attentionPath + '.tmp', JSON.stringify(state) + '\n');
  renameSync(attentionPath + '.tmp', attentionPath);
}

async function serveMcp() {
  let config;
  let discord;
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    void (async () => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        return;
      }
      if (request.id === undefined) return;
      let result;
      try {
        if (request.method === 'initialize')
          result = {
            protocolVersion: request.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'career-discord', version: '1.0.0' },
          };
        else if (request.method === 'ping') result = {};
        else if (request.method === 'tools/list') result = { tools: discordTools };
        else if (request.method === 'tools/call') {
          try {
            config ||= validateConfig(
              JSON.parse(readFileSync(join(root, 'config/discord-lead.json'), 'utf8')),
            );
            discord ||= new Discord(loadDiscordToken());
            const receipt = await callDiscordTool(request.params.name, request.params.arguments, {
              config,
              discord,
              saveAttention,
              updateBoard: () => refreshStatusBoard(discord, config),
            });
            result = { content: [{ type: 'text', text: JSON.stringify(receipt) }], isError: false };
          } catch (error) {
            result = { content: [{ type: 'text', text: error.message }], isError: true };
          }
        } else {
          console.log(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: 'Unsupported MCP method.' },
            }),
          );
          return;
        }
        console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      } catch {
        console.log(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32602, message: 'Invalid MCP request.' },
          }),
        );
      }
    })();
  });
}

async function main() {
  if (process.argv.slice(2).join(' ') === '--mcp') return serveMcp();
  const options = messageOptions(process.argv.slice(2));
  const config = validateConfig(
    JSON.parse(readFileSync(join(root, 'config/discord-lead.json'), 'utf8')),
  );
  if (!options.send) {
    console.log('Dry run: owner DM / attention-count update validated. Nothing sent or written.');
    return;
  }
  if (options.text !== undefined) {
    const sent = await sendOwnerDm(new Discord(loadDiscordToken()), config, options.text);
    console.log('Discord confirmed DM delivery: ' + sent.map(item => item.id).join(', '));
  }
  if (options.actions !== undefined || options.blockers !== undefined) {
    const state = readAttention();
    for (const key of ['actions', 'blockers'])
      if (options[key] !== undefined) state[key] = options[key];
    writeFileSync(attentionPath + '.tmp', JSON.stringify(state) + '\n');
    renameSync(attentionPath + '.tmp', attentionPath);
    await refreshStatusBoard(new Discord(loadDiscordToken()), config);
    console.log('Attention counts saved; pinned board and channel topic refreshed.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
