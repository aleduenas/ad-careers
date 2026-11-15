import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/root.mjs';
import { createLivenessWriter, loadEligibleJobs, readLastFullCheck } from './liveness-store.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL posting check integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_liveness_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
let pool;
let schemaCreated = false;

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
  pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 4 });
  const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
  const makeJob = async (n, status = 'Pending') => {
    const [job] = await q("SELECT * FROM create_job('Acme',$1,$2,$3,NULL,'2026-10-01')", [
      `Engineer ${n}`,
      `https://example.test/${n}`,
      `k${n}`,
    ]);
    if (status !== 'Pending')
      await q('SELECT change_job_status($1,$2,$3,$4,$5)', [
        job.id,
        job.revision,
        status,
        'seed',
        'test',
      ]);
    return String(job.id);
  };

  // Table constraints (migration 014).
  const a = await makeJob(1);
  const insert = (state, action) =>
    q('INSERT INTO posting_checks(job_id,state,method,detail,action) VALUES($1,$2,$3,$4,$5)', [
      a,
      state,
      'greenhouse',
      '',
      action,
    ]);
  await insert('open', 'none');
  await insert('closed', 'discarded');
  await insert('probably_closed', 'flagged');
  await insert('unknown', 'held_back');
  await assert.rejects(insert('gone', 'none'), { code: '23514' });
  await assert.rejects(insert('open', 'deleted'), { code: '23514' });
  // browser_runs accepts the liveness action and still refuses an unknown one.
  await q(
    "INSERT INTO browser_runs(request_key,action,log_ref) VALUES('lv-1','liveness','lv-1.log')",
  );
  await assert.rejects(
    q("INSERT INTO browser_runs(request_key,action,log_ref) VALUES('lv-2','bogus','lv-2.log')"),
    { code: '23514' },
  );
  // D116 columns: nullable, bounded.
  await q('SELECT sync_job_description($1,$2,$3,$4)', [a, '# JD', 'jds/a.md', 'hash']);
  await q("UPDATE job_descriptions SET yoe_min=3, yoe_confidence='high' WHERE job_id=$1", [a]);
  await assert.rejects(q('UPDATE job_descriptions SET yoe_min=41 WHERE job_id=$1', [a]), {
    code: '23514',
  });
  await assert.rejects(
    q("UPDATE job_descriptions SET yoe_confidence='sure' WHERE job_id=$1", [a]),
    { code: '23514' },
  );
  await q('DELETE FROM browser_runs');
  await q('DELETE FROM posting_checks');

  // loadEligibleJobs: eligible statuses, restored, active task (run and claim).
  const pending = await makeJob(2);
  const applied = await makeJob(3, 'Applied');
  const interview = await makeJob(4, 'Interview');
  const restored = await makeJob(5);
  const busyRun = await makeJob(6);
  const busyClaim = await makeJob(7);
  await q(
    "INSERT INTO job_status_events(job_id,old_status,new_status,reason,actor) VALUES($1,'Pending','Discarded','Posting expired','liveness-check')",
    [restored],
  );
  await q(
    "INSERT INTO browser_runs(request_key,action,job_id,log_ref,state,started_at) VALUES('r-1','evaluate',$1,'r-1.log','running',now())",
    [busyRun],
  );
  await q(
    "INSERT INTO browser_runs(request_key,action,job_id,log_ref) VALUES('r-2','liveness',$1,'r-2.log')",
    [pending],
  );
  await q("SELECT claim_work('evaluation:' || $1::text,'owner',300)", [busyClaim]);
  const jobs = new Map((await loadEligibleJobs(q)).map(job => [job.id, job]));
  assert.ok(!jobs.has(interview), 'Interview is never checked');
  assert.ok(jobs.has(pending) && jobs.has(applied));
  assert.equal(jobs.get(pending).activeTask, false, 'its own liveness run is not a task');
  assert.equal(jobs.get(pending).restored, false);
  assert.equal(jobs.get(restored).restored, true);
  assert.equal(jobs.get(busyRun).activeTask, true);
  assert.equal(jobs.get(busyClaim).activeTask, true);
  assert.equal((await loadEligibleJobs(q, pending)).length, 1);
  assert.equal((await loadEligibleJobs(q, interview)).length, 0);
  // A check row marking an earlier discard also counts as restored.
  await q(
    "INSERT INTO posting_checks(job_id,state,method,action) VALUES($1,'closed','x','discarded')",
    [applied],
  );
  assert.equal((await loadEligibleJobs(q, applied))[0].restored, true);
  await q('DELETE FROM browser_runs');

  // Writers: discard through change_job_status, once; a stale revision is a conflict.
  const writer = createLivenessWriter(q);
  const [target] = await loadEligibleJobs(q, pending);
  assert.equal(await writer.discard(target), 'discarded');
  const [after] = await q('SELECT status, revision::text AS revision FROM jobs WHERE id=$1', [
    pending,
  ]);
  assert.equal(after.status, 'Discarded');
  assert.equal(Number(after.revision), Number(target.revision) + 1);
  const [event] = await q(
    'SELECT new_status, reason, actor FROM job_status_events WHERE job_id=$1 ORDER BY id DESC LIMIT 1',
    [pending],
  );
  assert.deepEqual(event, {
    new_status: 'Discarded',
    reason: 'Posting expired',
    actor: 'liveness-check',
  });
  assert.equal(await writer.discard(target), 'conflict', 'stale revision skips the job');
  const [unchanged] = await q('SELECT status FROM jobs WHERE id=$1', [pending]);
  assert.equal(unchanged.status, 'Discarded');
  await writer.recordCheck(
    { id: pending },
    { state: 'closed', method: 'greenhouse', detail: 'gone' },
    'discarded',
  );
  const [row] = await q(
    'SELECT state, method, detail, action, checked_at FROM posting_checks WHERE job_id=$1',
    [pending],
  );
  assert.deepEqual(
    [row.state, row.method, row.detail, row.action],
    ['closed', 'greenhouse', 'gone', 'discarded'],
  );
  assert.ok(row.checked_at instanceof Date);

  // Summary: newest completed whole-board run, counting the checks in its window.
  assert.equal(await readLastFullCheck(q), null);
  await q('DELETE FROM posting_checks');
  const [run] = await q(
    "INSERT INTO browser_runs(request_key,action,log_ref,state,started_at) VALUES('all-1','liveness','all-1.log','running',now() - interval '1 minute') RETURNING id",
  );
  for (const [state, action] of [
    ['open', 'none'],
    ['closed', 'discarded'],
    ['closed', 'held_back'],
    ['probably_closed', 'flagged'],
    ['unknown', 'none'],
  ])
    await q('INSERT INTO posting_checks(job_id,state,method,action) VALUES($1,$2,$3,$4)', [
      applied,
      state,
      'x',
      action,
    ]);
  assert.equal(await readLastFullCheck(q), null, 'a running run is not a completed check');
  await q("SELECT finish_browser_run($1,'completed',0,NULL)", [run.id]);
  const summary = await readLastFullCheck(q);
  assert.deepEqual(
    { ...summary, finishedAt: typeof summary.finishedAt },
    {
      finishedAt: 'string',
      checked: 5,
      open: 1,
      closed: 2,
      probablyClosed: 1,
      unknown: 1,
      discarded: 1,
      flagged: 2,
      heldBack: 1,
    },
  );

  // Deleting a job cascades to its checks.
  await q('DELETE FROM browser_runs');
  await q('DELETE FROM job_status_events WHERE job_id=$1', [applied]);
  await q('DELETE FROM jobs WHERE id=$1', [applied]);
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM posting_checks WHERE job_id=$1', [applied]))[0].n,
    0,
  );

  console.log('liveness database tests OK');
} finally {
  await pool?.end();
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
