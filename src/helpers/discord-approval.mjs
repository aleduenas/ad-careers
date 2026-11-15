#!/usr/bin/env node
// Reads the owner's check-mark reaction on one of the lead's own DMs. Read-only apart from the
// optional --mark, which adds the lead's own check to show that the message is a decision.
// The owner approves a decision by adding his check to the lead's; any other answer is a reply.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../lib/root.mjs';
import { Discord, validateConfig } from './_discord-lead.mjs';
import { loadDiscordToken } from './discord-message.mjs';

export const CHECK = encodeURIComponent('✅');
const ID = /^[0-9]{17,20}$/;

async function ownerDm(discord, config) {
  const dm = await discord.api('POST', '/users/@me/channels', { recipient_id: config.owner_id });
  if (dm.type !== 1 || dm.recipients?.length !== 1 || dm.recipients[0].id !== config.owner_id)
    throw new Error('Discord did not return the configured owner-only DM.');
  return dm.id;
}

// Approved only when the message is in the owner-only DM, was written by this bot, carries the
// lead's own check (it was offered as a decision) and the configured owner added his check too.
export async function checkApproval(discord, config, messageId, { mark = false } = {}) {
  if (!ID.test(messageId || '')) throw new Error('Give a numeric Discord message ID.');
  const dm = await ownerDm(discord, config);
  const me = await discord.api('GET', '/users/@me');
  const message = await discord.api('GET', `/channels/${dm}/messages/${messageId}`);
  if (message.author?.id !== me.id)
    throw new Error('That message was not sent by the lead; a check on it approves nothing.');
  const path = `/channels/${dm}/messages/${messageId}/reactions/${CHECK}`;
  if (mark) await discord.api('PUT', `${path}/@me`);
  const users = await discord.api('GET', `${path}?limit=100`);
  const marked = users.some(user => user.id === me.id);
  return {
    message_id: messageId,
    first_line: String(message.content || '')
      .split('\n')[0]
      .slice(0, 160),
    marked,
    approved: marked && users.some(user => user.id === config.owner_id),
  };
}

export async function waitForApproval(
  discord,
  config,
  messageId,
  { mark = false, seconds = 0, every = 15, sleep = delay, now = Date.now } = {},
) {
  const deadline = now() + seconds * 1000;
  let result = await checkApproval(discord, config, messageId, { mark });
  while (!result.approved && now() < deadline) {
    await sleep(every * 1000);
    result = await checkApproval(discord, config, messageId);
  }
  return { ...result, timed_out: !result.approved && seconds > 0 };
}

export function approvalOptions(args) {
  const usage = 'Use --message=ID [--mark] [--wait=SECONDS].';
  const options = { mark: false, seconds: 0 };
  for (const arg of args) {
    if (arg === '--mark') options.mark = true;
    else if (/^--message=[0-9]{17,20}$/.test(arg)) options.messageId = arg.split('=')[1];
    else if (/^--wait=[0-9]{1,5}$/.test(arg)) options.seconds = Number(arg.split('=')[1]);
    else throw new Error(usage);
  }
  if (!options.messageId) throw new Error(usage);
  if (options.seconds > 43200) throw new Error('Wait at most 43200 seconds.');
  return options;
}

async function main() {
  const { messageId, ...options } = approvalOptions(process.argv.slice(2));
  const config = validateConfig(
    JSON.parse(readFileSync(join(root, 'config/discord-lead.json'), 'utf8')),
  );
  const discord = new Discord(loadDiscordToken());
  console.log(JSON.stringify(await waitForApproval(discord, config, messageId, options)));
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
