import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyLegacyRecord,
  createLegacyRuns,
  legacyRunId,
  parseLegacyRecord,
} from './legacy-runs.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const iso = offsetMs => new Date(NOW + offsetMs).toISOString();

function record(overrides = {}) {
  return {
    action: 'evaluate',
    number: 12,
    pid: 4242,
    log: 'C:\\repo\\logs\\dashboard\\evaluate-12-20261110-110000-123.log',
    state: 'completed',
    phase: 'done',
    attempt: 1,
    started_at: iso(-3600_000),
    updated_at: iso(-3500_000),
    finished_at: iso(-3500_000),
    exit_code: 0,
    ...overrides,
  };
}

async function withTasks(files, callback, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'career-ops-legacy-'));
  try {
    await mkdir(join(root, 'logs', 'dashboard', 'tasks'), { recursive: true });
    for (const [name, content] of Object.entries(files))
      await writeFile(
        join(root, 'logs', 'dashboard', 'tasks', name),
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    const legacy = createLegacyRuns({
      rootDir: root,
      now: () => new Date(NOW),
      isAlive: pid => pid === 4242,
      processStartTime: async () => null,
      ...options,
    });
    await callback(legacy, root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

test('parseLegacyRecord: valid records normalize, malformed ones are refused with a reason', () => {
  const ok = parseLegacyRecord(JSON.stringify(record()), 'evaluate-12-20261110-110000-123.json');
  assert.equal(ok.ok, true);
  assert.equal(ok.record.action, 'evaluate');
  assert.equal(ok.record.number, 12);
  assert.equal(ok.record.browserRun, false);
  assert.equal(ok.record.startedAt, iso(-3600_000));
  // Missing optional fields get defaults (a running record has no finish or exit code).
  const sparse = parseLegacyRecord(
    JSON.stringify({ action: 'cv', state: 'running', pid: 5 }),
    'cv-0-x-1.json',
  );
  assert.equal(sparse.ok, true);
  assert.deepEqual(
    [sparse.record.number, sparse.record.attempt, sparse.record.exitCode, sparse.record.log],
    [0, 1, null, ''],
  );
  for (const [text, reason] of [
    ['{ nope', 'not JSON'],
    ['[]', 'not an object'],
    ['null', 'not an object'],
    [JSON.stringify(record({ action: 'rm -rf' })), 'unknown action'],
    [JSON.stringify(record({ action: 5 })), 'unknown action'],
    [JSON.stringify(record({ state: 'weird' })), 'unknown state'],
    [JSON.stringify(record({ number: 'x' })), 'bad number'],
    [JSON.stringify(record({ pid: -1 })), 'bad number'],
    [JSON.stringify(record({ attempt: 0 })), 'bad number'],
    [JSON.stringify(record({ exit_code: 1.5 })), 'bad number'],
    [JSON.stringify(record({ started_at: 'yesterday' })), 'bad timestamp'],
    [JSON.stringify(record({ log: 5 })), 'bad log'],
  ]) {
    const result = parseLegacyRecord(text, 'x.json');
    assert.equal(result.ok, false, text);
    assert.equal(result.reason, reason, text);
  }
  // A browser run is recognised by its run_id or by the 8-hex file name tail.
  assert.equal(
    parseLegacyRecord(JSON.stringify(record({ run_id: 'abc' })), 'a.json').record.browserRun,
    true,
  );
  assert.equal(
    parseLegacyRecord(JSON.stringify(record()), 'cv-4-20261110-110000-1a2b3c4d.json').record
      .browserRun,
    true,
  );
  assert.equal(
    parseLegacyRecord(JSON.stringify(record()), 'cv-4-20261110-110000-1790606265842804700.json')
      .record.browserRun,
    false,
  );
});

test('classifyLegacyRecord: terminal states stand; a running record needs a live, matching owner', async () => {
  const parsed = overrides =>
    parseLegacyRecord(JSON.stringify(record({ state: 'running', ...overrides })), 'a-1-2-3.json')
      .record;
  const options = (extra = {}) => ({
    now: NOW,
    isAlive: pid => pid === 4242,
    processStartTime: async () => null,
    ...extra,
  });
  assert.deepEqual(await classifyLegacyRecord(parsed({ state: 'completed' }), options()), {
    state: 'completed',
    errorCode: null,
  });
  assert.deepEqual(await classifyLegacyRecord(parsed({ state: 'failed' }), options()), {
    state: 'failed',
    errorCode: 'EXIT_NONZERO',
  });
  // Live owner: running.
  assert.equal((await classifyLegacyRecord(parsed({}), options())).state, 'running');
  // Dead owner (and no pid) read as interrupted.
  assert.deepEqual(await classifyLegacyRecord(parsed({ pid: 9 }), options()), {
    state: 'interrupted',
    errorCode: 'PROCESS_GONE',
  });
  assert.equal((await classifyLegacyRecord(parsed({ pid: 0 }), options())).state, 'interrupted');
  // Running for more than a day: interrupted even when the pid is alive.
  assert.deepEqual(
    await classifyLegacyRecord(parsed({ started_at: iso(-25 * 3600_000) }), options()),
    { state: 'interrupted', errorCode: 'STALE_24H' },
  );
  // Recycled pid: alive, but its start time is far from the recorded start.
  const recycled = await classifyLegacyRecord(
    parsed({ started_at: iso(-600_000) }),
    options({ processStartTime: async () => new Date(NOW - 60_000) }),
  );
  assert.equal(recycled.state, 'interrupted');
  // The genuine owner started a moment after the TUI stamped started_at.
  const genuine = await classifyLegacyRecord(
    parsed({ started_at: iso(-600_000) }),
    options({ processStartTime: async () => new Date(NOW - 600_000 + 800) }),
  );
  assert.equal(genuine.state, 'running');
  // A start time that cannot be read falls back to the plain liveness answer.
  assert.equal(
    (
      await classifyLegacyRecord(
        parsed({}),
        options({
          processStartTime: async () => {
            throw new Error('denied');
          },
        }),
      )
    ).state,
    'running',
  );
});

test('list: wire shape, source legacy, id from the file name, no write-back, newest first', async () => {
  await withTasks(
    {
      'evaluate-12-a-1.json': record(),
      'cv-7-b-2.json': record({
        action: 'cv',
        number: 7,
        state: 'failed',
        exit_code: 3,
        finished_at: iso(-60_000),
        updated_at: iso(-60_000),
      }),
      'both-0-c-3.json': record({ action: 'both', number: 0, finished_at: iso(-7200_000) }),
    },
    async (legacy, root) => {
      const rows = await legacy.list({ limit: 50 });
      assert.deepEqual(
        rows.map(run => run.requestKey),
        ['legacy:cv-7-b-2', 'legacy:evaluate-12-a-1', 'legacy:both-0-c-3'],
      );
      const [failed, done, both] = rows;
      for (const run of rows) {
        assert.equal(run.source, 'legacy');
        assert.equal(run.groupId, null);
        assert.deepEqual(run.selection, {});
        assert.match(
          run.id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        assert.equal(Date.parse(run.createdAt) > 0, true);
      }
      assert.equal(failed.state, 'failed');
      assert.equal(failed.errorCode, 'EXIT_NONZERO');
      assert.equal(failed.exitCode, 3);
      assert.equal(done.jobId, '12');
      assert.equal(both.jobId, null, 'number 0 means no job');
      assert.equal(both.action, 'both');
      assert.equal(done.id, legacyRunId('evaluate-12-a-1'));
      assert.equal(JSON.stringify(rows).includes('repo'), false, 'no log path leaks');
      assert.equal(JSON.stringify(rows).includes(root), false);
      // The job filter and the terminal limit.
      assert.deepEqual(
        (await legacy.list({ jobId: '7', limit: 50 })).map(run => run.jobId),
        ['7'],
      );
      assert.equal((await legacy.list({ limit: 1 })).length, 1);
      assert.equal((await legacy.list({ limit: 0 })).length, 0);
    },
  );
});

test('list: running rows are always included; dead, recycled and old owners read as interrupted', async () => {
  const running = overrides =>
    record({ state: 'running', finished_at: undefined, exit_code: undefined, ...overrides });
  await withTasks(
    {
      'live-1-a-1.json': running({ started_at: iso(-60_000), updated_at: iso(-30_000) }),
      'dead-2-a-2.json': running({ pid: 9, number: 2 }),
      'old-3-a-3.json': running({ number: 3, started_at: iso(-30 * 3600_000) }),
      'recycled-4-a-4.json': running({ number: 4, started_at: iso(-600_000) }),
    },
    async legacy => {
      const rows = await legacy.list({ limit: 1 });
      const byKey = Object.fromEntries(rows.map(run => [run.requestKey, run]));
      assert.equal(byKey['legacy:live-1-a-1'].state, 'running');
      assert.equal(byKey['legacy:live-1-a-1'].finishedAt, null);
      assert.equal(rows[0].state, 'running', 'active rows come first');
      // Only one terminal row fits the limit of 1.
      assert.equal(rows.filter(run => run.state !== 'running').length, 1);
      const all = Object.fromEntries(
        (await legacy.list({ limit: 50 })).map(run => [run.jobId, run]),
      );
      assert.equal(all['2'].state, 'interrupted');
      assert.equal(all['2'].errorCode, 'PROCESS_GONE');
      assert.equal(all['3'].errorCode, 'STALE_24H');
      assert.equal(all['4'].state, 'interrupted');
      assert.equal(all['4'].finishedAt !== null, true);
    },
    { processStartTime: async () => new Date(NOW - 30_000) },
  );
});

test('list: malformed, oversized, linked and browser-run records are skipped, counted and never thrown', async () => {
  await withTasks(
    {
      'good-1-a-1.json': record(),
      'bad-json.json': '{ nope',
      'bad-action.json': record({ action: 'format-disk' }),
      'huge.json': JSON.stringify({ ...record(), pad: 'x'.repeat(70 * 1024) }),
      'notes.txt': 'ignored, not a record',
      'cv-4-20261110-110000-1a2b3c4d.json': record({ action: 'cv' }),
      'with-run-id.json': record({ run_id: '11111111-2222-4333-8444-555555555555' }),
    },
    async (legacy, root) => {
      const rows = await legacy.list({ limit: 50 });
      assert.deepEqual(
        rows.map(run => run.requestKey),
        ['legacy:good-1-a-1'],
      );
      assert.deepEqual(legacy.stats(), { skipped: 3 });
      try {
        await symlink(
          join(root, 'logs', 'dashboard', 'tasks', 'good-1-a-1.json'),
          join(root, 'logs', 'dashboard', 'tasks', 'link.json'),
        );
        assert.equal((await legacy.list({ limit: 50 })).length, 1, 'a symbolic link is not read');
      } catch {
        // Symbolic links are not available on this host.
      }
    },
  );
  // A missing folder is an empty list.
  const empty = createLegacyRuns({ rootDir: join(tmpdir(), 'career-ops-no-such-root-x') });
  assert.deepEqual(await empty.list(), []);
});

test('find resolves a wire id and names only the log file, never a path', async () => {
  await withTasks({ 'evaluate-12-a-1.json': record() }, async legacy => {
    const hit = await legacy.find(legacyRunId('evaluate-12-a-1'));
    assert.equal(hit.run.jobId, '12');
    assert.equal(hit.logRef, 'evaluate-12-20261110-110000-123.log');
    assert.equal(await legacy.find('11111111-2222-4333-8444-555555555555'), null);
  });
  await withTasks({ 'x-1-a-1.json': record({ log: '../../etc/passwd' }) }, async legacy => {
    const hit = await legacy.find(legacyRunId('x-1-a-1'));
    assert.equal(
      hit.logRef,
      'passwd',
      'only the file name survives, and is re-rooted by the caller',
    );
  });
  await withTasks({ 'x-1-a-1.json': record({ log: '' }) }, async legacy => {
    assert.equal((await legacy.find(legacyRunId('x-1-a-1'))).logRef, null);
  });
});
