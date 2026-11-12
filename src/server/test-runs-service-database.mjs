import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/root.mjs';
import { createJobsDetail } from './jobs-detail.mjs';
import { createLetterService } from './letter.mjs';
import { createRunsService, LAUNCHERS } from './runs.mjs';
import { createRunsStore } from './runs-store.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL runs service integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_runs_service_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
let pool;
let schemaCreated = false;
let rootDir;

// Synthetic launcher: stays alive briefly so "running" is observable, then exits cleanly.
const SYNTHETIC = `
console.log('synthetic launcher ' + process.argv.slice(2).join(' ') + ' run=' + process.env.CAREER_RUN_ID);
setTimeout(() => {}, Number(process.env.SYNTH_HOLD_MS || 700));
`;

const reject = async (promise, check) => {
  await assert.rejects(promise, error => {
    check(error);
    return true;
  });
};

async function until(check, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('timed out waiting for ' + label);
}

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await admin.query(`SET search_path TO "${schema}"`);
  for (const name of readdirSync(join(root, 'infra/sql/migrations'))
    .filter(n => n.endsWith('.sql'))
    .sort())
    await admin.query(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));
  const poolUrl = new URL(url);
  poolUrl.searchParams.set('options', `-c search_path=${schema}`);
  pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 6 });
  const rows = async (sql, args = []) => (await pool.query(sql, args)).rows;

  const job = (
    await rows(
      "SELECT * FROM create_job('Acme','Engineer','https://example.test/svc','svc',NULL,'2026-10-01')",
    )
  )[0];
  const jobId = String(job.id);
  const snapshot = async () =>
    JSON.stringify([
      await rows('SELECT * FROM jobs ORDER BY id'),
      await rows('SELECT * FROM evaluations ORDER BY id'),
      await rows('SELECT * FROM job_status_events ORDER BY id'),
      await rows('SELECT * FROM job_descriptions ORDER BY job_id'),
    ]);
  const before = await snapshot();

  rootDir = await mkdtemp(join(tmpdir(), 'career-ops-runs-db-'));
  for (const parts of Object.values(LAUNCHERS)) {
    await mkdir(join(rootDir, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(rootDir, ...parts), SYNTHETIC);
  }

  const store = createRunsStore({ query: (sql, args) => pool.query(sql, args) });
  const errors = [];
  // Default job lookup and readiness go through the real SQL on the isolated schema.
  const service = createRunsService({
    store,
    query: rows,
    rootDir,
    onError: error => errors.push(error),
    intervalMs: 60_000,
  });

  assert.equal(await service.ready(), true, 'migration present on the test schema');

  // Dispatch: queued -> running through the real functions, then completed by the exit observer.
  const created = await service.dispatch({ action: 'evaluate', jobId, requestKey: 'svc-1' });
  assert.equal(created.replayed, false);
  const [run] = created.runs;
  assert.equal(run.state, 'running');
  assert.equal(run.jobId, jobId);
  const stored = await store.get(run.id);
  assert.equal(stored.state, 'running');
  assert.ok(stored.pid > 0 && stored.pidStartedAt && stored.startedAt, 'pid and start time stored');
  const done = await until(async () => {
    const current = await store.get(run.id);
    return current.state === 'completed' ? current : null;
  }, 'completion');
  assert.deepEqual([done.exitCode, done.errorCode], [0, null]);
  assert.ok(done.finishedAt);
  const log = await service.log(run.id);
  assert.match(log.text, /synthetic launcher --job=\d+ run=/);

  // Real unique constraint: same digest replays, another job or action is 409.
  const replay = await service.dispatch({ action: 'evaluate', jobId, requestKey: 'svc-1' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.runs[0].id, run.id);
  await assert.rejects(
    service.dispatch({ action: 'cv', jobId, requestKey: 'svc-1' }),
    error => error.statusCode === 409 && error.publicCode === 'REQUEST_KEY_CONFLICT',
  );
  await assert.rejects(
    service.dispatch({ action: 'evaluate', jobId: '999999', requestKey: 'svc-2' }),
    error => error.statusCode === 404,
  );

  // A pair shares one group through the real table.
  const pair = await service.dispatch({ action: 'both', jobId, requestKey: 'svc-pair' });
  assert.equal(pair.runs.length, 2);
  assert.equal(pair.runs[0].groupId, pair.runs[1].groupId);
  await until(
    async () => (await store.list({ jobId })).every(r => r.state === 'completed'),
    'pair',
  );

  // Reconcile against a dead pid: start a run row on a process that has already exited.
  const gone = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise(resolve => gone.once('exit', resolve));
  const orphan = await store.insert({
    requestKey: 'orphan',
    action: 'evaluate',
    jobId,
    logRef: 'evaluate-orphan.log',
  });
  await store.start(orphan.id, gone.pid, new Date());
  const alive = await store.insert({
    requestKey: 'alive',
    action: 'evaluate',
    jobId,
    logRef: 'evaluate-alive.log',
  });
  await store.start(alive.id, process.pid, new Date(Date.now() - process.uptime() * 1000));
  const changed = await service.reconcile();
  assert.deepEqual(
    changed.map(r => [r.id, r.state, r.errorCode]),
    [[orphan.id, 'interrupted', 'PROCESS_GONE']],
  );
  assert.equal((await store.get(alive.id)).state, 'running', 'a live process is left alone');
  assert.equal((await store.get(run.id)).state, 'completed', 'terminal rows are untouched');
  assert.deepEqual(await service.reconcile(), [], 'a second pass changes nothing');
  await store.finish(alive.id, 'interrupted', null, 'TEST_CLEANUP');

  // The list read sees the real rows through the service.
  const listed = await service.list({ jobId });
  assert.ok(listed.runs.length >= 4);
  assert.ok(listed.runs.every(r => r.source === 'browser' && !('pid' in r)));
  assert.deepEqual(errors, [], 'no background error was reported');

  assert.equal(await snapshot(), before, 'dispatch and reconcile leave business tables unchanged');
  // Dispatch prerequisites and the active-run rule against real rows (STAGE3_DISPATCH_CONTRACT.md).
  const detail = createJobsDetail({ query: rows, rootDir });
  const gated = createRunsService({
    store,
    query: rows,
    rootDir,
    actionsFor: detail.actionsFor,
    checkProvider: async provider => ({ available: true, command: provider }),
    onError: error => errors.push(error),
    intervalMs: 60_000,
  });
  let jobCounter = 0;
  const makeJob = async (status, { withJd = true, reportFile = false, score = null } = {}) => {
    jobCounter += 1;
    const created = (
      await rows("SELECT * FROM create_job('Gate Co', $1, $2, $3, NULL, '2026-10-02'::date)", [
        'Gate Role ' + jobCounter,
        'https://example.test/gate/' + jobCounter,
        'example.test/gate/' + jobCounter,
      ])
    )[0];
    const id = String(created.id);
    await rows('UPDATE jobs SET status = $2, score = $3, report_path = $4 WHERE id = $1', [
      id,
      status,
      score,
      reportFile ? 'data/evaluations/gate-' + id + '.md' : null,
    ]);
    if (withJd)
      await rows("SELECT sync_job_description($1, 'Gate JD text', 'data/jds/gate.md', 'hash')", [
        id,
      ]);
    if (reportFile) {
      await mkdir(join(rootDir, 'data', 'evaluations'), { recursive: true });
      await writeFile(join(rootDir, 'data', 'evaluations', 'gate-' + id + '.md'), '# Report');
    }
    return id;
  };
  const pendingJd = await makeJob('Pending');
  const pendingNoJd = await makeJob('Pending', { withJd: false });
  const evaluated = await makeJob('Evaluated', { reportFile: true, score: '5.0' });
  const evaluatedLowScore = await makeJob('Evaluated', { reportFile: true, score: '0.1' });
  const evaluatedNoReport = await makeJob('Evaluated');
  const applied = await makeJob('Applied', { reportFile: true });
  const flags = async id => {
    const { actions } = await detail.detail(id);
    return ['evaluate', 'cv', 'letter', 'both'].map(name => actions[name].enabled);
  };
  assert.deepEqual(await flags(pendingJd), [true, false, false, false]);
  assert.deepEqual(await flags(pendingNoJd), [false, false, false, false]);
  assert.deepEqual(
    await flags(evaluated),
    [true, true, true, true],
    'D070: Evaluated can be re-evaluated',
  );
  assert.deepEqual(await flags(applied), [false, true, true, true]);
  assert.deepEqual(
    await flags(evaluatedLowScore),
    [true, true, true, true],
    'the score is never a rule',
  );
  assert.deepEqual(await flags(evaluatedNoReport), [true, false, false, false]);
  assert.equal(
    (await detail.detail(evaluatedNoReport)).actions.cv.reason,
    'Evaluate the job first.',
  );
  assert.equal(
    (await detail.detail(pendingNoJd)).actions.evaluate.reason,
    'No job description stored.',
  );

  const runCount = async () => Number((await rows('SELECT count(*) AS n FROM browser_runs'))[0].n);
  const runsBefore = await runCount();
  await reject(
    gated.dispatch({ action: 'evaluate', jobId: pendingNoJd, requestKey: 'gate-1' }),
    error => {
      assert.equal(error.publicCode, 'PREREQUISITE_FAILED');
      assert.equal(error.message, 'No job description stored.');
      assert.equal(error.current.actions.evaluate.enabled, false);
    },
  );
  await reject(
    gated.dispatch({ action: 'cv', jobId: evaluatedNoReport, requestKey: 'gate-2' }),
    error => assert.equal(error.message, 'Evaluate the job first.'),
  );
  await reject(
    gated.dispatch({ action: 'evaluate', jobId: applied, requestKey: 'gate-3' }),
    error => assert.equal(error.message, 'Only Pending or Evaluated jobs can be evaluated.'),
  );
  await reject(
    gated.dispatch({ action: 'both', jobId: evaluatedNoReport, requestKey: 'gate-4' }),
    error => assert.equal(error.publicCode, 'PREREQUISITE_FAILED'),
  );
  assert.equal(await runCount(), runsBefore, 'rejected dispatches record nothing');

  // A real run makes the action unavailable for that job until it finishes.
  process.env.SYNTH_HOLD_MS = '1500';
  const first = await gated.dispatch({
    action: 'evaluate',
    jobId: pendingJd,
    requestKey: 'gate-eval',
  });
  const firstId = first.runs[0].id;
  assert.equal(
    (await detail.detail(pendingJd)).actions.evaluate.reason,
    'A evaluate run is already active.',
  );
  await reject(
    gated.dispatch({ action: 'evaluate', jobId: pendingJd, requestKey: 'gate-eval-2' }),
    error => {
      assert.equal(error.publicCode, 'RUN_ACTIVE');
      assert.deepEqual(error.current, { activeRunId: firstId });
    },
  );
  assert.equal(
    (await gated.dispatch({ action: 'evaluate', jobId: pendingJd, requestKey: 'gate-eval' }))
      .replayed,
    true,
    'a replay is not blocked',
  );
  // Another action or another job is unaffected; a pair is blocked by an active child.
  const cv = await gated.dispatch({
    action: 'cv',
    jobId: evaluated,
    requestKey: 'gate-cv',
    selection: { cv: { provider: 'codex', model: 'gpt-override' } },
  });
  assert.deepEqual(
    (await store.get(cv.runs[0].id)).selection,
    { cv: { provider: 'codex', model: 'gpt-override' } },
    'the merged selection is stored in the real jsonb column',
  );
  assert.deepEqual(cv.runs[0].selection, { cv: { provider: 'codex', model: 'gpt-override' } });
  assert.deepEqual(await flags(evaluated), [true, false, true, false]);
  await reject(
    gated.dispatch({ action: 'both', jobId: evaluated, requestKey: 'gate-both-busy' }),
    error => assert.equal(error.publicCode, 'RUN_ACTIVE'),
  );
  await until(async () => (await store.get(firstId)).state === 'completed', 'evaluate completion');
  await until(async () => (await store.get(cv.runs[0].id)).state === 'completed', 'cv completion');
  assert.deepEqual(
    await flags(pendingJd),
    [true, false, false, false],
    'available again once the run finished',
  );
  const gatedPair = await gated.dispatch({
    action: 'both',
    jobId: evaluated,
    requestKey: 'gate-both',
  });
  assert.equal(gatedPair.runs.length, 2);
  assert.equal(gatedPair.runs[0].groupId, gatedPair.runs[1].groupId);
  await until(
    async () =>
      (await Promise.all(gatedPair.runs.map(run => store.get(run.id)))).every(
        run => run.state === 'completed',
      ),
    'pair completion',
  );
  // The settings file is not part of any of this: dispatch only reads.
  assert.deepEqual(errors, [], 'no background error was reported');

  // Publication (STAGE3_LETTER_CONTRACT.md): the publish run row through the real store, with a
  // synthetic launcher and the real letter service over the temporary root.
  const letters = createLetterService({ query: rows, rootDir });
  const publisher = createRunsService({
    store,
    query: rows,
    rootDir,
    actionsFor: detail.actionsFor,
    letterService: letters,
    onError: error => errors.push(error),
    intervalMs: 60_000,
  });
  const publishId = await makeJob('Evaluated');
  const publishRow = (await rows('SELECT company, role FROM jobs WHERE id = $1', [publishId]))[0];
  assert.equal(
    (await detail.detail(publishId)).actions.publish.reason,
    'No cover letter to publish.',
  );
  await reject(
    publisher.dispatch({
      action: 'publish',
      jobId: publishId,
      requestKey: 'pub-none',
      expectedHash: 'a'.repeat(64),
    }),
    error => assert.equal(error.publicCode, 'PREREQUISITE_FAILED'),
  );
  const letterDir = join(
    rootDir,
    'output',
    publishRow.company.toLowerCase().replaceAll(' ', '-'),
    'gate-role--' + publishId,
  );
  await mkdir(letterDir, { recursive: true });
  const letterFile = join(letterDir, 'cover-letter.md');
  await writeFile(letterFile, 'Dear team,\n\nA synthetic letter.\n');
  assert.deepEqual((await detail.detail(publishId)).actions.publish, {
    enabled: true,
    reason: null,
  });
  const loaded = await letters.read(publishId);
  const publishRuns = async () =>
    rows("SELECT * FROM browser_runs WHERE action = 'publish' ORDER BY created_at");
  await reject(
    publisher.dispatch({
      action: 'publish',
      jobId: publishId,
      requestKey: 'pub-stale',
      expectedHash: 'b'.repeat(64),
    }),
    error => {
      assert.equal(error.publicCode, 'LETTER_CONFLICT');
      assert.equal(error.current.contentHash, loaded.contentHash);
    },
  );
  assert.equal((await publishRuns()).length, 0, 'a refused publish records nothing');
  process.env.SYNTH_HOLD_MS = '1500';
  const published = await publisher.dispatch({
    action: 'publish',
    jobId: publishId,
    requestKey: 'pub-ok',
    expectedHash: loaded.contentHash,
  });
  const [publishRun] = published.runs;
  assert.equal(publishRun.action, 'publish');
  assert.equal(publishRun.jobId, publishId);
  assert.deepEqual(publishRun.selection, {});
  const [publishStored] = await publishRuns();
  assert.deepEqual(
    [
      publishStored.action,
      String(publishStored.job_id),
      publishStored.selection,
      publishStored.state,
    ],
    ['publish', publishId, {}, 'running'],
    'the real row: job set, no selection',
  );
  // While it runs, the real active-run query blocks a save and a second publish.
  await reject(
    letters.save(publishId, { expectedHash: loaded.contentHash, text: 'Edited\n' }),
    error => {
      assert.equal(error.publicCode, 'RUN_ACTIVE');
      assert.deepEqual(error.current, { activeRunId: publishRun.id });
    },
  );
  await reject(
    publisher.dispatch({
      action: 'publish',
      jobId: publishId,
      requestKey: 'pub-twice',
      expectedHash: loaded.contentHash,
    }),
    error => assert.equal(error.publicCode, 'RUN_ACTIVE'),
  );
  assert.equal(
    (await detail.detail(publishId)).actions.publish.reason,
    'A publish run is already active.',
  );
  await until(
    async () => (await store.get(publishRun.id)).state === 'completed',
    'publish completion',
  );
  const publishLog = await publisher.log(publishRun.id);
  assert.match(publishLog.text, /synthetic launcher .*cover-letter\.md run=/);
  assert.doesNotMatch(publishLog.text, /--job/);
  // Finished: saving works again and the next publish needs the new hash.
  const resaved = await letters.save(publishId, {
    expectedHash: loaded.contentHash,
    text: 'Edited\n',
  });
  assert.equal(resaved.text, 'Edited\n');
  await reject(
    publisher.dispatch({
      action: 'publish',
      jobId: publishId,
      requestKey: 'pub-old-hash',
      expectedHash: loaded.contentHash,
    }),
    error => assert.equal(error.publicCode, 'LETTER_CONFLICT'),
  );
  const republished = await publisher.dispatch({
    action: 'publish',
    jobId: publishId,
    requestKey: 'pub-new-hash',
    expectedHash: resaved.contentHash,
  });
  await until(
    async () => (await store.get(republished.runs[0].id)).state === 'completed',
    'republish completion',
  );
  assert.equal(await readFile(letterFile, 'utf8'), 'Edited\n');
  assert.deepEqual(errors, [], 'no background error was reported');

  console.log(
    'PostgreSQL runs service passed: real-store dispatch, running to completed through SQL, replay and conflict, pair grouping, dead-pid reconcile, business-table isolation, dispatch prerequisites against real rows, the active-run rule, the selection override and the publish run row',
  );
} finally {
  await pool?.end().catch(() => {});
  if (rootDir) await rm(rootDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 });
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await admin.end().catch(() => {});
}
