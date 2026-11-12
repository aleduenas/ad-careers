import assert from 'node:assert/strict';
import test from 'node:test';
import { createGhosting } from './ghosting.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a pass checks readiness, calls the SQL rule once and logs the count', async () => {
  const calls = [];
  const logs = [];
  const ghosting = createGhosting({
    readiness: async () => calls.push('readiness'),
    query: async sql => {
      calls.push(sql);
      return [{ moved: 3 }];
    },
    log: message => logs.push(message),
  });
  assert.equal(await ghosting.runOnce(), 3);
  assert.deepEqual(calls, ['readiness', 'SELECT ghost_stale_applications() AS moved']);
  assert.deepEqual(logs, ['Ghosting: 3 stale applications moved to Ghosted.']);
  const one = createGhosting({
    readiness: async () => {},
    query: async () => [{ moved: 1 }],
    log: m => logs.push(m),
  });
  await one.runOnce();
  assert.equal(logs.at(-1), 'Ghosting: 1 stale application moved to Ghosted.');
});

test('a failing readiness or query skips quietly and never leaks driver text', async () => {
  const logs = [];
  const errors = [];
  for (const options of [
    {
      readiness: async () => {
        throw new Error('secret-driver-text');
      },
      query: async () => assert.fail('must not query when not ready'),
    },
    {
      readiness: async () => {},
      query: async () => {
        throw new Error('secret-driver-text');
      },
    },
  ]) {
    const ghosting = createGhosting({
      ...options,
      log: m => logs.push(m),
      onError: e => errors.push(e),
    });
    assert.equal(await ghosting.runOnce(), null);
  }
  assert.deepEqual(logs, [
    'Ghosting: skipped (database not ready).',
    'Ghosting: skipped (database not ready).',
  ]);
  assert.equal(logs.join('').includes('secret'), false);
  assert.equal(errors.length, 2);
});

test('passes never overlap, and start/stop drive the schedule', async () => {
  let passes = 0;
  let release;
  const gate = new Promise(resolve => (release = resolve));
  const ghosting = createGhosting({
    readiness: async () => {},
    query: async () => {
      passes++;
      await gate;
      return [{ moved: 0 }];
    },
    log: () => {},
  });
  const first = ghosting.runOnce();
  assert.equal(await ghosting.runOnce(), null, 'a pass already running is not started twice');
  release();
  await first;
  assert.equal(passes, 1);

  let ticks = 0;
  const scheduled = createGhosting({
    readiness: async () => {},
    query: async () => (ticks++, [{ moved: 0 }]),
    log: () => {},
    intervalMs: 20,
  });
  scheduled.start();
  scheduled.start();
  await wait(120);
  scheduled.stop();
  const stopped = ticks;
  assert.ok(stopped >= 3, 'runs at startup and then on the interval');
  await wait(80);
  assert.ok(ticks - stopped <= 1, 'no pass after stop');
});

test('factory rejects non-function adapters', () => {
  assert.throws(() => createGhosting({ query: 'no' }), TypeError);
  assert.throws(() => createGhosting({ readiness: null }), TypeError);
  assert.throws(() => createGhosting({ log: 5 }), TypeError);
});
