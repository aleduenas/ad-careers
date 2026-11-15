import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveness } from './liveness.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const NOW = new Date('2026-11-15T12:00:00Z');
const hoursAgo = hours => new Date(NOW.getTime() - hours * 3600_000);

// A stub database: running flag and the last completed whole-board run.
function stub({ running = false, finishedAt = null } = {}) {
  return async sql => {
    if (/EXISTS\(SELECT 1 FROM browser_runs/.test(sql)) return [{ running }];
    if (/FROM browser_runs/.test(sql))
      return finishedAt
        ? [{ started_at: new Date(finishedAt - 600_000), finished_at: finishedAt }]
        : [];
    return [
      {
        checked: 4,
        open: 2,
        closed: 1,
        probably_closed: 1,
        unknown: 0,
        discarded: 1,
        flagged: 1,
        held_back: 0,
      },
    ];
  };
}

function make(options = {}) {
  const dispatched = [];
  const logs = [];
  const liveness = createLiveness({
    query: stub(options),
    readiness: options.readiness ?? (async () => {}),
    dispatch: options.noDispatch ? null : async input => dispatched.push(input),
    activeScan: async () => options.scan ?? null,
    daily: true,
    now: () => NOW,
    log: message => logs.push(message),
    onError: () => {},
  });
  return { liveness, dispatched, logs };
}

test('summary: running flag and the last full check', async () => {
  const { liveness } = make({ running: true, finishedAt: hoursAgo(2) });
  assert.deepEqual(await liveness.summary(), {
    running: true,
    lastFullCheck: {
      finishedAt: hoursAgo(2).toISOString(),
      checked: 4,
      open: 2,
      closed: 1,
      probablyClosed: 1,
      unknown: 0,
      discarded: 1,
      flagged: 1,
      heldBack: 0,
    },
  });
  assert.deepEqual(await make().liveness.summary(), { running: false, lastFullCheck: null });
});

test('daily run starts when there is no check or the last one is over a day old', async () => {
  for (const finishedAt of [null, hoursAgo(25)]) {
    const { liveness, dispatched, logs } = make({ finishedAt });
    assert.equal(await liveness.runOnce(), 'started');
    assert.deepEqual(dispatched, [
      { action: 'liveness', requestKey: 'liveness-daily-20261115T12' },
    ]);
    assert.deepEqual(logs, ['Posting check: daily run started.']);
  }
});

test('daily run never overlaps itself or a scan and waits when the last check is fresh', async () => {
  for (const [options, expected] of [
    [{ finishedAt: hoursAgo(3) }, 'fresh'],
    [{ running: true }, 'running'],
    [{ scan: 'run-1' }, 'scan-active'],
    [{ noDispatch: true }, 'skipped'],
  ]) {
    const { liveness, dispatched } = make(options);
    assert.equal(await liveness.runOnce(), expected);
    assert.equal(dispatched.length, 0);
  }
  // Two passes at once start one run.
  let release;
  const gate = new Promise(resolve => (release = resolve));
  const dispatched = [];
  const liveness = createLiveness({
    query: stub(),
    readiness: async () => gate,
    dispatch: async input => dispatched.push(input),
    daily: true,
    now: () => NOW,
    log: () => {},
  });
  const first = liveness.runOnce();
  assert.equal(await liveness.runOnce(), 'skipped');
  release();
  assert.equal(await first, 'started');
  assert.equal(dispatched.length, 1);
});

test('a failing readiness or dispatch skips quietly and leaks no driver text', async () => {
  const logs = [];
  const errors = [];
  const failing = async () => {
    throw new Error('secret-driver-text');
  };
  for (const options of [
    { readiness: failing, dispatch: async () => {} },
    { readiness: async () => {}, dispatch: failing },
  ]) {
    const liveness = createLiveness({
      query: stub(),
      daily: true,
      now: () => NOW,
      log: m => logs.push(m),
      onError: e => errors.push(e),
      ...options,
    });
    assert.equal(await liveness.runOnce(), 'skipped');
  }
  assert.deepEqual(logs, [
    'Posting check: daily run skipped.',
    'Posting check: daily run skipped.',
  ]);
  assert.equal(errors.length, 2);
  assert.ok(!logs.join('').includes('secret'));
});

test('the timer exists only when daily is set, and adapters are validated', async () => {
  const dispatched = [];
  const off = createLiveness({
    query: stub(),
    dispatch: async input => dispatched.push(input),
    now: () => NOW,
    log: () => {},
  });
  off.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  off.stop();
  assert.equal(dispatched.length, 0);
  assert.throws(() => createLiveness({ query: 'x' }), TypeError);
  assert.throws(() => createLiveness({ dispatch: 'x' }), TypeError);
});
