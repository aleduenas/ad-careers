import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/_database.mjs';
import { importRecords } from './import-legacy.mjs';
import { withJobID, jdJobID } from '../lib/_job-descriptions.mjs';
const tagged = withJobID('# Original JD\n', 1057);
assert.equal(jdJobID(tagged), '1057');
assert.equal(withJobID(tagged, 1057), tagged);
assert.throws(() => withJobID(tagged, 999), /belongs to/);
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');
const schema = 'test_' + randomUUID().replaceAll('-', ''),
  admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('CREATE SCHEMA ' + schema);
parsed.searchParams.set('options', '-c search_path=' + schema);
const pool = new pg.Pool({ connectionString: parsed.toString() });
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
try {
  const migrations = readdirSync(join(root, 'infra/sql/migrations'))
    .filter(n => n.endsWith('.sql'))
    .sort();
  for (const name of migrations.filter(n => n < '007_'))
    await q(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));
  await q(
    "INSERT INTO jobs(id,company,role,status,notes,applied_at,report_path) VALUES (90,'Legacy','Exact application','Applied','Applied 2026-05-20; preserved','2026-09-18T18:41:42Z',NULL),(91,'Legacy','Unknown application','Applied','No transition date','2026-09-18T18:41:42Z',NULL),(92,'Legacy','Exact rejection','Rejected','Rejected 2026-05-26; preserved',NULL,NULL),(93,'Legacy','Unknown rejection','Rejected','No transition date',NULL,NULL),(94,'Legacy','Dated evaluation','Evaluated','',NULL,'data/evaluations/094-legacy-2026-06-01.md')",
  );
  await q(
    "INSERT INTO job_status_events(job_id,new_status,reason,actor,created_at) VALUES (90,'Applied','Imported','migration','2026-09-18T18:41:42Z'),(91,'Applied','Imported','migration','2026-09-18T18:41:42Z'),(92,'Rejected','Imported','migration','2026-09-18T18:41:42Z'),(93,'Rejected','Imported','migration','2026-09-18T18:41:42Z'),(94,'Evaluated','Imported','migration','2026-09-18T18:41:42Z')",
  );
  await q(
    readFileSync(
      join(root, 'infra/sql/migrations/007_repair_imported_application_dates.sql'),
      'utf8',
    ),
  );
  await q(readFileSync(join(root, 'infra/sql/migrations/008_status_event_occurrence.sql'), 'utf8'));
  const repairedDates = await q('SELECT id,applied_at FROM jobs WHERE id IN (90,91) ORDER BY id');
  assert.equal(
    repairedDates[0].applied_at.toISOString().slice(0, 10),
    '2026-05-20',
    'explicit legacy application date is recovered',
  );
  assert.equal(repairedDates[1].applied_at, null, 'unknown legacy application date stays null');
  const occurred = await q('SELECT job_id,occurred_at FROM job_status_events ORDER BY job_id');
  assert.equal(
    occurred[0].occurred_at.toISOString().slice(0, 10),
    '2026-05-20',
    'exact legacy application occurrence is recovered',
  );
  assert.equal(occurred[1].occurred_at, null, 'unknown legacy application occurrence stays null');
  assert.equal(
    occurred[2].occurred_at.toISOString().slice(0, 10),
    '2026-05-26',
    'exact legacy rejection occurrence is recovered',
  );
  assert.equal(occurred[3].occurred_at, null, 'unknown legacy rejection occurrence stays null');
  assert.equal(
    occurred[4].occurred_at.toISOString().slice(0, 10),
    '2026-06-01',
    'dated evaluation report recovers occurrence',
  );
  await q('TRUNCATE jobs,job_status_events RESTART IDENTITY CASCADE');
  const transact = async fn => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await fn(c);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const imported = {
    errors: [],
    fingerprint: 'fixture',
    lastAllocated: 100,
    jobs: [
      {
        id: '19',
        company: 'Legacy',
        role: 'Engineer',
        status: 'Applied',
        notes: 'Preserved note',
        score: 4,
        source_date: null,
        report_path: 'reports/missing.md',
      },
      {
        id: '20',
        company: 'Pending',
        role: 'Analyst',
        status: 'Pending',
        notes: '',
        score: null,
        source_date: null,
      },
    ],
    history: [['https://example.test/seen', null, 'fixture', '', '', '', '']],
  };
  await assert.rejects(
    importRecords(
      { ...imported, history: [['bad', 'invalid-date', '', '', '', '', '']] },
      transact,
    ),
  );
  assert.equal(
    Number((await q('SELECT count(*) FROM jobs'))[0].count),
    0,
    'failed import rolls back every record',
  );
  await importRecords(imported, transact);
  await importRecords(imported, transact);
  assert.equal(
    Number((await q('SELECT count(*) FROM jobs'))[0].count),
    2,
    'repeat import does not duplicate jobs',
  );
  assert.equal(
    Number((await q('SELECT count(*) FROM job_status_events'))[0].count),
    2,
    'repeat import does not duplicate history',
  );
  assert.equal((await q('SELECT source_date FROM jobs WHERE id=19'))[0].source_date, null);
  await assert.rejects(
    importRecords({ ...imported, fingerprint: 'different' }, transact),
    /empty database/,
  );
  await q(
    'TRUNCATE jobs,evaluations,job_status_events,scan_history,legacy_imports RESTART IDENTITY CASCADE',
  );
  const add = async key =>
    (
      await q('SELECT * FROM create_job($1,$2,$3,$4,$5,$6::date)', [
        'Acme',
        'Engineer',
        'https://example.test/' + key,
        key,
        null,
        '2026-09-19',
      ])
    )[0];
  const duplicates = await Promise.all(Array.from({ length: 12 }, () => add('same')));
  assert.equal(new Set(duplicates.map(j => j.id)).size, 1, 'concurrent discovery deduplicates');
  const localISO = d =>
    d instanceof Date
      ? d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      : String(d).slice(0, 10);
  assert.equal(
    localISO(duplicates[0].source_date),
    '2026-09-19',
    'newly ingested jobs retain their source date',
  );
  const jobs = await Promise.all(Array.from({ length: 15 }, (_, i) => add('job' + i)));
  assert.equal(new Set(jobs.map(j => j.id)).size, 15, 'IDs are unique');
  await Promise.all(
    jobs.map(j => q("SELECT change_job_status($1,$2,'Applied','','test')", [j.id, j.revision])),
  );
  const job = await add('conflict');
  const updates = await Promise.allSettled(
    ['Applied', 'Ghosted'].map(s =>
      q("SELECT change_job_status($1,$2,$3,'','test')", [job.id, job.revision, s]),
    ),
  );
  assert.equal(
    updates.filter(r => r.status === 'fulfilled').length,
    1,
    'stale writer cannot overwrite',
  );
  const pending = await add('evaluation');
  assert.equal(
    (await q("SELECT claim_work($1,'owner',300) AS ok", ['evaluation:' + pending.id]))[0].ok,
    true,
  );
  assert.equal(
    (await q("SELECT claim_work($1,'intruder',300) AS ok", ['evaluation:' + pending.id]))[0].ok,
    false,
  );
  await assert.rejects(
    q("SELECT change_job_status($1,0,'Discarded','','test')", [pending.id]),
    /Discard reason is required/,
  );
  await q("SELECT change_job_status($1,0,'Discarded','manual','test')", [pending.id]);
  const args = [
    pending.id,
    'owner',
    'completion',
    4,
    'data/evaluations/test.md',
    'Evaluated',
    'result',
  ];
  await q('SELECT complete_evaluation($1,$2,$3,$4,$5,$6,$7)', args);
  await q('SELECT complete_evaluation($1,$2,$3,$4,$5,$6,$7)', args);
  assert.equal(
    (await q('SELECT status FROM jobs WHERE id=$1', [pending.id]))[0].status,
    'Discarded',
  );
  assert.equal(
    Number((await q('SELECT count(*) FROM evaluations')).at(0).count),
    1,
    'completion is idempotent',
  );
  await assert.rejects(
    q('SELECT complete_evaluation($1,$2,$3,$4,$5,$6,$7)', [
      ...args.slice(0, 3),
      3,
      ...args.slice(4),
    ]),
    /idempotency/,
  );
  await q("UPDATE workflow_claims SET expires_at=now()-interval '1 second'");
  assert.equal(
    (await q("SELECT claim_work($1,'new-owner',300) AS ok", ['evaluation:' + pending.id]))[0].ok,
    true,
  );
  await assert.rejects(
    q('SELECT complete_evaluation($1,$2,$3,$4,$5,$6,$7)', [
      pending.id,
      'owner',
      'second',
      4,
      'reports/new.md',
      'Evaluated',
      '',
    ]),
    /lease/,
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE jobs SET notes='rollback' WHERE id=$1", [pending.id]);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  assert.notEqual(
    (await q('SELECT notes FROM jobs WHERE id=$1', [pending.id]))[0].notes,
    'rollback',
  );
  const metadata = await add('metadata');
  await q('SELECT sync_job_description($1,$2,$3,$4)', [
    metadata.id,
    '# Raw JD\nUnicode: café 🚀',
    'jds/acme/test.md',
    'hash',
  ]);
  await q('SELECT sync_job_description($1,$2,$3,$4)', [
    metadata.id,
    '# Raw JD\nUnicode: café 🚀',
    'jds/acme/test.md',
    'hash',
  ]);
  assert.equal(
    Number(
      (await q('SELECT revision FROM job_descriptions WHERE job_id=$1', [metadata.id]))[0].revision,
    ),
    1,
    'unchanged JD sync is idempotent',
  );
  await q('SELECT sync_job_description($1,$2,$3,$4)', [
    metadata.id,
    'Changed JD',
    'jds/acme/test.md',
    'new',
  ]);
  assert.equal(
    Number(
      (await q('SELECT revision FROM job_descriptions WHERE job_id=$1', [metadata.id]))[0].revision,
    ),
    2,
  );
  await q('SELECT update_job_metadata($1,0,$2,$3)', [metadata.id, 'Updated role', 'A note']);
  await assert.rejects(
    q('SELECT update_job_metadata($1,0,$2,$3)', [metadata.id, 'Stale role', 'Stale note']),
    /Revision conflict/,
  );
  assert.equal(
    (await q('SELECT role FROM jobs WHERE id=$1', [metadata.id]))[0].role,
    'Updated role',
  );
  console.log(
    'PostgreSQL integration passed: IDs, concurrent creation/updates, stale revisions, late completion, retries, leases and rollback',
  );
} finally {
  await pool.end();
  await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
  await admin.end();
}
