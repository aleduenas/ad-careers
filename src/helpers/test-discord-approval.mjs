import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECK, approvalOptions, checkApproval, waitForApproval } from './discord-approval.mjs';

const owner = '12345678901234567',
  bot = '22345678901234567',
  dm = '32345678901234567',
  message = '42345678901234567',
  stranger = '52345678901234567';
const config = { owner_id: owner };

function fake({ author = bot, reactors = [], recipients = [{ id: owner }], type = 1 } = {}) {
  const calls = [];
  const state = { reactors: [...reactors] };
  return {
    calls,
    state,
    api: async (method, path) => {
      calls.push(`${method} ${path}`);
      if (path === '/users/@me/channels') return { id: dm, type, recipients };
      if (path === '/users/@me') return { id: bot };
      if (path === `/channels/${dm}/messages/${message}`)
        return { author: { id: author }, content: 'D900: apply the thing\nmore' };
      if (method === 'PUT' && path.endsWith(`/reactions/${CHECK}/@me`)) {
        state.reactors.push(bot);
        return null;
      }
      if (method === 'GET' && path.includes(`/reactions/${CHECK}`))
        return state.reactors.map(id => ({ id }));
      throw new Error('unexpected call ' + method + ' ' + path);
    },
  };
}

test('the owner check on the lead message approves', async () => {
  const result = await checkApproval(fake({ reactors: [bot, owner] }), config, message);
  assert.deepEqual(result, {
    message_id: message,
    first_line: 'D900: apply the thing',
    marked: true,
    approved: true,
  });
});

test('the lead check alone, or a check by anyone else, approves nothing', async () => {
  assert.equal((await checkApproval(fake({ reactors: [bot] }), config, message)).approved, false);
  assert.equal(
    (await checkApproval(fake({ reactors: [bot, stranger] }), config, message)).approved,
    false,
  );
  assert.equal((await checkApproval(fake(), config, message)).approved, false);
});

test('a check on a message the lead did not write is refused', async () => {
  await assert.rejects(
    checkApproval(fake({ author: owner, reactors: [owner] }), config, message),
    /not sent by the lead/,
  );
});

test('a channel that is not the owner-only DM is refused', async () => {
  await assert.rejects(
    checkApproval(fake({ recipients: [{ id: stranger }] }), config, message),
    /owner-only DM/,
  );
  await assert.rejects(checkApproval(fake({ type: 0 }), config, message), /owner-only DM/);
  await assert.rejects(checkApproval(fake(), config, 'abc'), /numeric Discord message ID/);
});

test('mark adds the lead check once and reading never writes', async () => {
  const marked = fake();
  const result = await checkApproval(marked, config, message, { mark: true });
  assert.equal(result.marked, true);
  assert.equal(result.approved, false);
  assert.equal(marked.calls.filter(call => call.startsWith('PUT')).length, 1);
  const read = fake({ reactors: [bot] });
  await checkApproval(read, config, message);
  assert.equal(
    read.calls.some(call => /^(PUT|DELETE|PATCH)/.test(call)),
    false,
  );
});

test('waiting polls until the owner checks or the time runs out', async () => {
  const discord = fake({ reactors: [bot] });
  let clock = 0,
    sleeps = 0;
  const sleep = async ms => {
    clock += ms;
    sleeps += 1;
    if (sleeps === 2) discord.state.reactors.push(owner);
  };
  const result = await waitForApproval(discord, config, message, {
    seconds: 300,
    every: 15,
    sleep,
    now: () => clock,
  });
  assert.equal(result.approved, true);
  assert.equal(result.timed_out, false);
  assert.equal(sleeps, 2);

  clock = 0;
  const never = await waitForApproval(fake({ reactors: [bot] }), config, message, {
    seconds: 30,
    every: 15,
    sleep: async ms => {
      clock += ms;
    },
    now: () => clock,
  });
  assert.equal(never.approved, false);
  assert.equal(never.timed_out, true);
});

test('options are strict', () => {
  assert.deepEqual(approvalOptions([`--message=${message}`, '--mark', '--wait=600']), {
    mark: true,
    seconds: 600,
    messageId: message,
  });
  assert.throws(() => approvalOptions([]), /--message=ID/);
  assert.throws(() => approvalOptions([`--message=${message}`, '--wait=99999']), /at most/);
  assert.throws(() => approvalOptions(['--message=1; rm']), /--message=ID/);
});
