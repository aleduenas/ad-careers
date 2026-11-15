import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/root.mjs';
import { createRunsStore, RunsStoreError } from './runs-store.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL browser runs integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_runs_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
const pools = [];
let schemaCreated = false;
const openPool = () => {
  const poolUrl = new URL(url);
  poolUrl.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 12 });
  pools.push(pool);
  return pool;
};

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await admin.query(`SET search_path TO "${schema}"`);
  const migrations = readdirSync(join(root, 'infra/sql/migrations'))
    .filter(n => n.endsWith('.sql'))
    .sort();
  assert.ok(migrations.includes('010_browser_runs.sql'), 'migration 010 is present');
  for (const name of migrations)
    await admin.query(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));

  const pool = openPool();
  const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
  const store = createRunsStore({ query: (sql, args) => pool.query(sql, args) });
  const keyOf = () => 'key-' + randomUUID();
  const draft = (extra = {}) => ({
    requestKey: keyOf(),
    action: 'evaluate',
    logRef: 'run-' + randomUUID() + '.log',
    ...extra,
  });
  const terminalStates = ['completed', 'failed', 'interrupted'];

  // Business fixtures whose rows must never change because of a run write.
  const job = (
    await q(
      "SELECT * FROM create_job('Acme','Engineer','https://example.test/a','a',NULL,'2026-10-01')",
    )
  )[0];
  await q("SELECT change_job_status($1,$2,'Evaluated','seed','test')", [job.id, job.revision]);
  await q('SELECT sync_job_description($1,$2,$3,$4)', [job.id, '# JD', 'jds/a.md', 'hash']);
  await q("SELECT claim_work('evaluation:' || $1::text,'owner',300)", [job.id]);
  await q(
    "INSERT INTO evaluations(job_id,operation_key,score,report_path,result_status) VALUES($1,'op',4,'r.md','Evaluated')",
    [job.id],
  );
  const business = [
    'jobs',
    'evaluations',
    'job_status_events',
    'job_descriptions',
    'workflow_claims',
  ];
  const snapshot = async () => {
    const out = {};
    for (const table of business)
      out[table] = (await q(`SELECT row_to_json(t)::text AS r FROM ${table} t ORDER BY 1`)).map(
        r => r.r,
      );
    return out;
  };
  const before = await snapshot();

  // Insert shape: uuid id, decimal-string job id, ISO timestamps, defaults.
  const first = await store.insert(draft({ jobId: String(job.id), selection: { version: 1 } }));
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.equal(first.jobId, String(job.id));
  assert.equal(typeof first.jobId, 'string');
  assert.equal(first.state, 'queued');
  assert.equal(first.phase, 'queued');
  assert.equal(first.attempt, 1);
  assert.equal(first.pid, null);
  assert.equal(first.startedAt, null);
  assert.equal(first.finishedAt, null);
  assert.deepEqual(first.selection, { version: 1 });
  assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
  assert.equal((await store.insert(draft())).jobId, null, 'job is optional');
  assert.deepEqual(await store.get(first.id), first, 'get returns the stored row');
  assert.equal(await store.get(randomUUID()), null, 'unknown id is null');

  // Duplicate request keys, unknown jobs and unsafe fields map to safe errors.
  await assert.rejects(
    store.insert({ ...draft(), requestKey: first.requestKey }),
    e =>
      e instanceof RunsStoreError &&
      e.code === 'REQUEST_KEY_CONFLICT' &&
      !/browser_runs/.test(e.message),
  );
  assert.equal((await store.getByRequestKey(first.requestKey)).id, first.id);
  assert.deepEqual(await store.listByGroup(randomUUID()), [], 'an unknown group has no runs');
  await assert.rejects(store.insert(draft({ jobId: '987654321' })), e => e.code === 'UNKNOWN_JOB');
  await assert.rejects(store.insert(draft({ jobId: 'abc' })), e => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(
    store.insert(draft({ action: 'format-disk' })),
    e => e.code === 'INVALID_ARGUMENT',
  );
  for (const logRef of ['../escape.log', 'logs/dashboard/x.log', 'C:\\x.log', ''])
    await assert.rejects(
      store.insert(draft({ logRef })),
      e => e.code === 'INVALID_ARGUMENT',
      logRef,
    );
  const racing = keyOf();
  const raced = await Promise.allSettled(
    Array.from({ length: 10 }, () => store.insert(draft({ requestKey: racing }))),
  );
  assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1, 'one concurrent insert wins');
  assert.ok(
    raced.filter(r => r.status === 'rejected').every(r => r.reason.code === 'REQUEST_KEY_CONFLICT'),
  );

  // Transitions: report before start, start once, never backwards.
  const run = await store.insert(draft({ jobId: String(job.id) }));
  const queuedReport = await store.report(run.id, 'drafting', 2);
  assert.equal(queuedReport.state, 'queued', 'report on a queued row is a no-op');
  assert.equal(queuedReport.phase, 'queued');
  const startedAt = new Date('2026-11-09T12:00:00Z');
  const started = await store.start(run.id, 4242, startedAt);
  assert.equal(started.state, 'running');
  assert.equal(started.pid, 4242);
  assert.equal(started.pidStartedAt, startedAt.toISOString());
  assert.ok(started.startedAt);
  const again = await store.start(run.id, 9999, new Date());
  assert.equal(again.pid, 4242, 'second start is a no-op');
  assert.equal(again.updatedAt, started.updatedAt);
  const reported = await store.report(run.id, 'scoring', 2);
  assert.equal(reported.phase, 'scoring');
  assert.equal(reported.attempt, 2);
  const sameAttempt = await store.report(run.id, 'writing', 2);
  assert.equal(sameAttempt.phase, 'writing', 'same attempt may advance the phase');
  const backwards = await store.report(run.id, 'earlier', 1);
  assert.equal(backwards.phase, 'writing', 'lower attempt is ignored');
  assert.equal(backwards.attempt, 2);
  await assert.rejects(store.report(run.id, '', 3), /Invalid run phase/);
  await assert.rejects(store.report(run.id, 'x', 0), /Invalid run attempt/);
  await assert.rejects(store.finish(run.id, 'running', 0, null), /Invalid terminal run state/);
  await assert.rejects(store.finish(run.id, 'queued', 0, null), /Invalid terminal run state/);
  await assert.rejects(store.start(randomUUID(), 1, new Date()), /Unknown browser run/);
  const done = await store.finish(run.id, 'completed', 0, null);
  assert.equal(done.state, 'completed');
  assert.equal(done.exitCode, 0);
  assert.ok(done.finishedAt);
  const second = await store.finish(run.id, 'failed', 1, 'LATE');
  assert.deepEqual(second, done, 'second terminal call is a no-op returning the row');
  assert.deepEqual(await store.report(run.id, 'late', 9), done, 'report after terminal is a no-op');
  assert.deepEqual(
    await store.start(run.id, 1, new Date()),
    done,
    'start after terminal is a no-op',
  );

  // Queued rows can fail directly (spawn failure) and then stay failed.
  const spawnFail = await store.insert(draft());
  const failed = await store.finish(spawnFail.id, 'failed', null, 'SPAWN_FAILED');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.errorCode, 'SPAWN_FAILED');
  assert.equal(failed.startedAt, null);
  assert.equal((await store.start(spawnFail.id, 5, new Date())).state, 'failed');

  // Races: one winner for concurrent starts and for concurrent terminal calls.
  const raceRun = await store.insert(draft());
  const starts = await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.start(raceRun.id, 1000 + i, new Date())),
  );
  assert.equal(new Set(starts.map(r => r.pid)).size, 1, 'concurrent starts agree on one pid');
  const finishes = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.finish(raceRun.id, terminalStates[i % 3], i % 3, 'E' + (i % 3)),
    ),
  );
  assert.equal(
    new Set(finishes.map(r => r.state)).size,
    1,
    'concurrent finishes agree on one state',
  );
  assert.equal(new Set(finishes.map(r => r.finishedAt)).size, 1);
  const final = await store.get(raceRun.id);
  assert.equal(final.state, finishes[0].state);
  assert.equal(final.errorCode, 'E' + terminalStates.indexOf(final.state));

  // Stale interruption: only running rows, by dead pid or the 24 hour rule.
  const mk = async pid => {
    const r = await store.insert(draft());
    return pid == null ? r : store.start(r.id, pid, new Date());
  };
  const dead = await mk(7001);
  const alive = await mk(7002);
  const old = await mk(7003);
  const queued = await mk(null);
  const terminal = await mk(7001);
  await store.finish(terminal.id, 'completed', 0, null);
  await q("UPDATE browser_runs SET started_at=now()-interval '25 hours' WHERE id=$1", [old.id]);
  const terminalBefore = await store.get(terminal.id);
  const interrupted = await store.interruptStale({
    deadPids: [7001, 7001, -3, 'x'],
    now: new Date(),
  });
  assert.deepEqual(
    interrupted.map(r => r.id).sort(),
    [dead.id, old.id].sort(),
    'only dead-pid and 24 h running rows change',
  );
  assert.equal((await store.get(dead.id)).errorCode, 'PROCESS_GONE');
  assert.equal((await store.get(old.id)).errorCode, 'STALE_24H');
  for (const r of interrupted) {
    assert.equal(r.state, 'interrupted');
    assert.ok(r.finishedAt);
  }
  assert.equal((await store.get(alive.id)).state, 'running');
  assert.equal((await store.get(queued.id)).state, 'queued');
  assert.deepEqual(await store.get(terminal.id), terminalBefore, 'terminal row untouched');
  assert.deepEqual(await store.interruptStale({ deadPids: [7001] }), [], 'repeat sweep is a no-op');
  const futureSweep = await store.interruptStale({
    deadPids: [],
    now: new Date(Date.now() + 25 * 3600e3),
  });
  assert.ok(
    futureSweep.some(r => r.id === alive.id),
    'now drives the 24 h rule',
  );
  assert.equal((await store.get(queued.id)).state, 'queued', 'queued rows are never interrupted');

  // Restart: a fresh pool and store see the same truthful state and keep reporting.
  const survivor = await mk(8001);
  await store.report(survivor.id, 'scoring', 1);
  const restartedPool = openPool();
  const restarted = createRunsStore({ query: (sql, args) => restartedPool.query(sql, args) });
  const seen = await restarted.get(survivor.id);
  assert.equal(seen.state, 'running');
  assert.equal(seen.phase, 'scoring');
  assert.equal(seen.pid, 8001);
  assert.ok(
    (await restarted.list()).some(r => r.id === survivor.id),
    'active run is listed after restart',
  );
  assert.equal((await restarted.finish(survivor.id, 'completed', 0, null)).state, 'completed');
  const orphan = await restarted.interruptStale({ deadPids: [8001] });
  assert.ok(!orphan.some(r => r.id === survivor.id), 'finished runs are not reinterpreted');

  // List: all active rows plus the newest terminal rows, optionally for one job.
  const forJob = await store.insert(draft({ jobId: String(job.id) }));
  const activeIds = (
    await q("SELECT id FROM browser_runs WHERE state IN ('queued','running')")
  ).map(r => r.id);
  const listed = await store.list({ limit: 2 });
  assert.equal(listed.filter(r => terminalStates.includes(r.state)).length, 2);
  for (const id of activeIds)
    assert.ok(
      listed.some(r => r.id === id),
      'every active run is listed',
    );
  const created = listed.map(r => r.createdAt);
  assert.deepEqual(created, [...created].sort().reverse(), 'newest first');
  const jobRuns = await store.list({ jobId: String(job.id), limit: 50 });
  assert.ok(jobRuns.length >= 3 && jobRuns.every(r => r.jobId === String(job.id)));
  assert.ok(jobRuns.some(r => r.id === forJob.id));
  assert.deepEqual(await store.list({ jobId: '424242' }), []);
  await assert.rejects(store.list({ jobId: '1; DROP' }), e => e.code === 'INVALID_ARGUMENT');

  // The schema carries the four functions and run states stay out of the job vocabulary.
  assert.deepEqual(
    (await q("SELECT proname FROM pg_proc WHERE proname LIKE '%browser_run%' ORDER BY 1")).map(
      r => r.proname,
    ),
    [
      'finish_browser_run',
      'interrupt_stale_browser_runs',
      'report_browser_run',
      'start_browser_run',
    ],
  );
  await assert.rejects(
    q("UPDATE browser_runs SET state='Applied' WHERE id=$1", [first.id]),
    /check constraint/,
  );

  // None of the run writes above touched a business table.
  assert.deepEqual(await snapshot(), before, 'run writes leave business tables unchanged');
  console.log(
    'PostgreSQL browser runs passed: insert/conflicts, once-only and forward-only transitions, races, dead-pid and 24 h interruption, restart view, listing and business-table isolation',
  );
} finally {
  await Promise.allSettled(pools.map(p => p.end()));
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await admin.end().catch(() => {});
}
