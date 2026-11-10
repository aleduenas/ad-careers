import assert from 'node:assert/strict';
import { root } from '../lib/root.mjs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { RemoteDecisions, Discord, codexEnvironment, chunks } from './_discord-lead.mjs';
import {
  trustedProjectMessage,
  channelPermissions,
  TopicStatus,
  StatusBoard,
} from './_discord-channel.mjs';
import { messageOptions, sendOwnerDm, callDiscordTool, discordTools } from './discord-message.mjs';
import { LeadBridge } from './discord-lead.mjs';

const owner = '12345678901234567',
  channel = '22345678901234567',
  dm = '32345678901234567',
  guild = '42345678901234567';
let nextId = 90000000000000000n;
const sends = [],
  replies = [],
  calls = [];
const discord = {
  send: async (destination, text, options) => {
    const id = String(++nextId);
    sends.push({ destination, text, options, id });
    return [{ id }];
  },
  api: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/users/@me/channels') return { id: dm, type: 1, recipients: [{ id: owner }] };
    return {
      topic: 'Existing project description',
      permissions: String((1n << 10n) | (1n << 11n) | (1n << 16n)),
    };
  },
};
const rpc = {
  write: reply => replies.push(reply),
  request: async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/read')
      return { thread: { sessionId: params.threadId === 'child' ? 'lead' : 'different' } };
    return { turn: { id: 'turn-2' } };
  },
};
const request = (id, method = 'item/commandExecution/requestApproval', extra = {}) => ({
  id,
  method,
  params: {
    threadId: 'lead',
    turnId: 'turn-1',
    command: 'node src/test-all.mjs --quick',
    ...extra,
  },
});
const queue = new RemoteDecisions(rpc.write, text => discord.send(dm, text));
await Promise.all([queue.add(request(1)), queue.add(request(2))]);
assert.equal(sends.length, 1, 'Only one approval is presented at a time.');
assert.equal(
  await queue.answer('ok', sends[0].id),
  false,
  'Older messages never approve new prompts.',
);
assert.equal(await queue.answer('ok', String(++nextId), 'unrelated-message'), false);
assert.equal(await queue.answer('change the implementation instead', String(++nextId)), false);
await queue.answer('ok', String(++nextId));
assert.deepEqual(replies.at(-1), { id: 1, result: { decision: 'accept' } });
assert.equal(sends.length, 2);
await queue.resolve('lead', 2);
assert.equal(queue.pending.size, 0);
assert.equal(
  await queue.answer('ok', String(++nextId)),
  false,
  'Native resolution invalidates the remote prompt.',
);
assert.equal(replies.length, 1);

await queue.add(
  request(3, 'item/permissions/requestApproval', { permissions: { network: { enabled: true } } }),
);
await queue.answer('yes', String(++nextId));
assert.deepEqual(replies.at(-1).result, {
  permissions: { network: { enabled: true } },
  scope: 'turn',
  strictAutoReview: true,
});
// No browser names, URL patterns, keyword filters or tool parameter allowlists.
await queue.add(
  request(4, 'mcpServer/elicitation/request', {
    serverName: 'any-server',
    mode: 'openaiForm',
    message: 'Use a browser on the authorized target',
    requestedSchema: { type: 'object', properties: {} },
    _meta: { tool_name: 'new.tool.name', tool_params: { url: 'https://example.test/path' } },
  }),
);
await queue.answer('ok', String(++nextId));
assert.deepEqual(replies.at(-1), { id: 4, result: { action: 'accept', content: {} } });
await queue.add(request(5));
await queue.answer('no', String(++nextId));
assert.deepEqual(replies.at(-1), { id: 5, result: { decision: 'decline' } });
await queue.add(
  request(6, 'item/tool/requestUserInput', {
    questions: [
      {
        id: 'color',
        question: 'Which color?',
        options: [{ label: 'Blue', description: 'Recommended' }],
      },
      { id: 'size', question: 'Which size?' },
    ],
  }),
);
await queue.answer('1', String(++nextId));
assert(sends.at(-1).text.includes('Which size?'));
assert.equal(replies.at(-1).id, 5, 'Partial multi-question answers stay pending.');
await queue.answer('large', String(++nextId));
assert.deepEqual(replies.at(-1).result, {
  answers: { color: { answers: ['Blue'] }, size: { answers: ['large'] } },
});
await queue.add(
  request(7, 'mcpServer/elicitation/request', {
    requestedSchema: {
      type: 'object',
      required: ['color'],
      properties: { color: { type: 'string' } },
    },
  }),
);
await queue.answer('green', String(++nextId));
assert.deepEqual(replies.at(-1).result, { action: 'accept', content: { color: 'green' } });
await queue.add(
  request(8, 'mcpServer/elicitation/request', {
    requestedSchema: {
      type: 'object',
      required: ['x', 'y'],
      properties: { x: { type: 'number' }, y: { type: 'boolean' } },
    },
  }),
);
await queue.answer('{"x":3}', String(++nextId));
assert(queue.pending.has(8));
await queue.answer('{"x":3,"y":true}', String(++nextId));
assert.deepEqual(replies.at(-1).result.content, { x: 3, y: true });
await assert.rejects(
  queue.add(
    request(9, 'item/tool/requestUserInput', {
      questions: [{ id: 'secret', question: 'Password?', isSecret: true }],
    }),
  ),
  /secure prompt/,
);
await queue.add(request(10));
await queue.clearTurn('other', 'turn-1');
assert(queue.pending.has(10));
await queue.clearTurn('lead', 'turn-1');
assert.equal(queue.pending.size, 0);

const bridge = new LeadBridge({ rpc, discord, channel, dm, threadId: 'lead' });
sends.length = 0;
const event = {
  method: 'item/completed',
  params: {
    threadId: 'lead',
    turnId: 'turn-1',
    item: {
      id: 'item-1',
      type: 'agentMessage',
      phase: 'commentary',
      text: 'The backend engineer finished the parser.',
    },
  },
};
await bridge.event(event);
await bridge.event(event);
assert.equal(sends.length, 0, 'Terminal commentary is never automatically published.');
assert.equal(bridge.lastUpdate, event.params.item.text);
await bridge.event({ ...event, params: { ...event.params, threadId: 'foreign' } });
assert.equal(sends.length, 0);
await bridge.message('Explain the change', String(++nextId), dm);
assert.equal(calls.at(-1).method, 'turn/start');
assert(calls.at(-1).params.input[0].text.includes('send_dm'));
await bridge.message('Also fix the race', String(++nextId), channel);
assert.equal(calls.at(-1).method, 'turn/steer');
await bridge.request(request(11));
const approvalId = sends.at(-1).id;
await bridge.message('ok', approvalId, dm);
assert.equal(replies.at(-1).id, 8, 'Stale approval text cannot become steering authorization.');
await bridge.message('ok', String(++nextId), dm);
assert.equal(replies.at(-1).id, 11);
await bridge.event({
  method: 'serverRequest/resolved',
  params: { threadId: 'lead', requestId: 12 },
});
await bridge.request(request(12));
assert.equal(
  bridge.decisions.pending.size,
  0,
  'Resolved requests arriving late are not presented.',
);
await bridge.request({ ...request(13), params: { ...request(13).params, threadId: 'child' } });
assert(bridge.decisions.pending.has(13));
await bridge.request({ ...request(14), params: { ...request(14).params, threadId: 'foreign' } });
assert(!bridge.decisions.pending.has(14));
const failed = request(15, 'unsupported/request');
await bridge.request(failed).catch(error => bridge.requestFailed(failed, error));
assert.equal(replies.at(-1).error.code, -32603);
assert.equal(sends.at(-1).destination, dm);

assert.deepEqual(
  await channelPermissions(discord, channel),
  [],
  'Pins/manage-channel permission is not required for delivery.',
);
let savedThread;
bridge.onThreadChange = id => {
  savedThread = id;
};
await bridge.event({
  method: 'thread/started',
  params: { thread: { id: 'cleared-chat', cwd: root, threadSource: 'user', parentThreadId: null } },
});
assert.equal(bridge.threadId, 'cleared-chat');
assert.equal(savedThread, 'cleared-chat');
await bridge.message('continue after clear', String(++nextId), channel);
assert.equal(calls.at(-1).params.threadId, 'cleared-chat');
await bridge.event({
  method: 'thread/started',
  params: { thread: { id: 'unrelated', cwd: 'other', threadSource: 'user' } },
});
assert.equal(bridge.threadId, 'cleared-chat');

const topic = new TopicStatus(discord, channel);
await topic.update(2, 1);
assert(calls.at(-1).body.topic.startsWith('Actions: 2 | Blockers: 1 | Attention needed'));
assert(!calls.at(-1).body.topic.includes('Attention pending'));
assert(!calls.at(-1).body.topic.includes('[career-ops status]'));
assert.equal(calls.at(-1).body.topic, 'Actions: 2 | Blockers: 1 | Attention needed');
const count = calls.length;
await topic.update(2, 1);
assert.equal(calls.length, count);
await topic.update(0, 1, 'https://example.test/pin', false);
assert.equal(calls.at(-1).body.topic, 'Actions: 0 | Blockers: 1 | https://example.test/pin');
await topic.update(0, 1, 'https://example.test/pin', true);
assert.equal(
  calls.at(-1).body.topic,
  'Actions: 0 | Blockers: 1 | Attention needed | https://example.test/pin',
);
const failures = [];
const unavailable = new TopicStatus(
  {
    api: async () => {
      throw new Error('Missing permission');
    },
  },
  channel,
  { report: text => failures.push(text) },
);
await unavailable.update(1, 0);
assert.equal(failures.length, 1);
await unavailable.update(0, 0);
assert.equal(failures.length, 1, 'Topic failures back off and never affect delivery.');

// Regression: even the exact obsolete block in the owner's screenshot stays local.
await bridge.event({
  method: 'item/completed',
  params: {
    threadId: bridge.threadId,
    turnId: 'dm-only',
    item: {
      id: 'legacy',
      type: 'agentMessage',
      phase: 'final_answer',
      text: 'Updates:\n- [DM send] hello world\nDecisions:\nNo action needed.\nBlockers:\nNo action needed.',
    },
  },
});
const beforeTool = sends.length;
await callDiscordTool(
  'send_dm',
  { text: 'hello world' },
  { discord, config: { owner_id: owner, project_channel_id: channel } },
);
assert.equal(sends.length, beforeTool + 1);
assert.equal(sends.at(-1).text, 'hello world');
assert.equal(sends.at(-1).destination, dm);
await callDiscordTool(
  'post_update',
  { text: 'The parser tests passed.' },
  { discord, config: { owner_id: owner, project_channel_id: channel } },
);
assert.equal(sends.at(-1).destination, channel);
assert.equal(sends.at(-1).text, 'The parser tests passed.');
let attention;
await callDiscordTool(
  'set_attention',
  { actions: 2, blockers: 1 },
  {
    saveAttention: value => {
      attention = value;
    },
  },
);
assert.deepEqual(attention, { actions: 2, blockers: 1 });
let boardArgs;
const boardReceipt = await callDiscordTool(
  'set_attention',
  { actions: ['Pick a layout'], blockers: ['[Needs you] Approve the schema'] },
  {
    saveAttention: () => {},
    updateBoard: value => {
      boardArgs = value;
      return { board_updated: true, message_id: 'pin-1' };
    },
  },
);
assert.deepEqual(boardArgs, {
  actions: ['Pick a layout'],
  blockers: ['[Needs you] Approve the schema'],
});
assert.deepEqual(boardReceipt, { attention_saved: true, board_updated: true, message_id: 'pin-1' });
assert.deepEqual(
  discordTools.map(tool => tool.name),
  ['send_dm', 'post_update', 'set_attention'],
);
await assert.rejects(
  callDiscordTool('send_dm', { text: 'hello', owner_id: 'other' }, { discord }),
  /Invalid/,
);
await assert.rejects(
  callDiscordTool('set_attention', { actions: -1, blockers: 0 }, {}),
  /nonnegative/,
);

const mcp = spawnSync(process.execPath, [join(root, 'src/helpers/discord-message.mjs'), '--mcp'], {
  encoding: 'utf8',
  timeout: 10000,
  windowsHide: true,
  input:
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }) +
    '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) +
    '\n',
});
assert.equal(mcp.status, 0, mcp.stderr);
const protocolReplies = mcp.stdout
  .trim()
  .split('\n')
  .map(line => JSON.parse(line));
assert.equal(protocolReplies[0].result.protocolVersion, '2024-11-05');
assert.deepEqual(
  protocolReplies[1].result.tools.map(tool => tool.name),
  ['send_dm', 'post_update', 'set_attention'],
);

const boardCalls = [];
const boardMessage = {
  id: '52345678901234567',
  author: { id: 'bot' },
  pinned: true,
  content: 'Old status',
};
const boardDiscord = {
  send: async () => {
    throw new Error('Existing pinned message must be reused.');
  },
  api: async (method, path, body) => {
    boardCalls.push({ method, path, body });
    if (path === '/users/@me') return { id: 'bot' };
    if (path.includes('/messages/')) {
      if (method === 'PATCH') boardMessage.content = body.content;
      return boardMessage;
    }
    return { topic: 'Project description' };
  },
};
const board = new StatusBoard(boardDiscord, channel, guild, {
  saved: { channel, messageId: boardMessage.id },
});
await board.update(1, 1, {
  actions: ['Choose a layout.'],
  blockers: ['Waiting for a test fixture.'],
});
assert(boardMessage.content.includes('Choose a layout.'));
assert(boardMessage.content.includes('Waiting for a test fixture.'));
assert(
  boardCalls
    .at(-1)
    .body.topic.includes(`https://discord.com/channels/${guild}/${channel}/${boardMessage.id}`),
);
const boardCount = boardCalls.length;
await board.update(1, 1, {
  actions: ['Choose a layout.'],
  blockers: ['Waiting for a test fixture.'],
});
assert.equal(boardCalls.length, boardCount, 'Unchanged status makes no API writes.');
await board.update(0, 0, { actions: [], blockers: [] });
assert(boardMessage.content.includes('No action needed.'));
assert.equal(board.messageId, boardMessage.id, 'Resolution edits the same message.');
let createdState;
let posts = 0;
const newDiscord = {
  ...boardDiscord,
  send: async (_channel, content) => {
    posts++;
    boardMessage.content = content;
    return [{ id: boardMessage.id }];
  },
};
const createdBoard = new StatusBoard(newDiscord, channel, guild, {
  save: value => {
    createdState = value;
  },
});
await createdBoard.update(0, 0);
assert.equal(posts, 1);
assert(
  boardCalls.some(
    call => call.method === 'PUT' && call.path.endsWith('/messages/pins/' + boardMessage.id),
  ),
);
const restartedBoard = new StatusBoard(newDiscord, channel, guild, { saved: createdState });
await restartedBoard.update(0, 0);
assert.equal(posts, 1, 'Restart reuses the saved message.');
let lists;
await callDiscordTool(
  'set_attention',
  { actions: ['Choose a layout'], blockers: [] },
  {
    saveAttention: value => {
      lists = value;
    },
  },
);
assert.deepEqual(lists, { actions: ['Choose a layout'], blockers: [] });

const incoming = {
  id: String(++nextId),
  content: 'continue',
  author: { id: owner },
  channel_id: dm,
  type: 0,
};
assert(trustedProjectMessage(incoming, owner, dm, channel, guild));
for (const patch of [
  { author: { id: 'other' } },
  { author: { id: owner, bot: true } },
  { webhook_id: 'hook' },
  { guild_id: guild },
  { channel_id: 'other' },
])
  assert(!trustedProjectMessage({ ...incoming, ...patch }, owner, dm, channel, guild));
assert(
  trustedProjectMessage(
    { ...incoming, channel_id: channel, guild_id: guild },
    owner,
    dm,
    channel,
    guild,
  ),
);
assert.deepEqual(messageOptions(['--dm', 'hello']), { send: false, text: 'hello' });
assert.deepEqual(messageOptions(['--send', '--actions=2', '--blockers=1']), {
  send: true,
  actions: 2,
  blockers: 1,
});
for (const args of [[], ['--dm'], ['--actions=-1'], ['--owner=other']])
  assert.throws(() => messageOptions(args));
assert.equal((await sendOwnerDm(discord, { owner_id: owner }, 'hello'))[0].id, sends.at(-1).id);
assert.equal(sends.at(-1).destination, dm);
await assert.rejects(
  sendOwnerDm(
    { api: async () => ({ type: 1, recipients: [{ id: 'other' }] }) },
    { owner_id: owner },
    'hello',
  ),
  /owner-only/,
);
let networkBody;
const rest = new Discord('synthetic-token', async (_url, options) => {
  networkBody = JSON.parse(options.body);
  return { ok: true, status: 200, json: async () => ({ id: 'confirmed' }) };
});
assert.deepEqual(await rest.send(dm, 'hello'), [{ id: 'confirmed' }]);
assert.deepEqual(networkBody.allowed_mentions, { parse: [] });
assert.equal(chunks('a'.repeat(2000)).join(''), 'a'.repeat(2000));
assert(
  !(
    'DISCORD_LEAD_BOT_TOKEN' in
    codexEnvironment({ DISCORD_LEAD_BOT_TOKEN: 'secret', PATH: 'local' })
  ),
);
console.log(
  'Discord lead checks passed: explicit MCP messages, no terminal forwarding, exact owner-only text, conversational approvals, stale/native resolution, topic isolation. No network or model turns.',
);
