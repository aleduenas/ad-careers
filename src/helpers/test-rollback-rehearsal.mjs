// Rehearses the additive-schema rollback of migrations 009 and 010 documented in
// notes/dashboard-migration/design/ROLLBACK.md. The SQL that is rolled back is read from
// that page, so the documented procedure is the tested procedure. Runs only in a unique schema of
// the isolated test database; the personal database is never touched.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/root.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED rollback rehearsal: TEST_DATABASE_URL is required (run via node src/helpers/db-test.mjs)',
  );
  process.exit(0);
}
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const migrations = join(root, 'infra/sql/migrations');
const files = readdirSync(migrations)
  .filter(n => n.endsWith('.sql'))
  .sort();
const migrationSql = prefix => {
  const name = files.find(n => n.startsWith(prefix));
  assert.ok(name, 'missing migration ' + prefix);
  return { name, sql: readFileSync(join(migrations, name), 'utf8') };
};

// The documented block that follows a <!-- rollback:NNN --> marker.
function rollbackBlock(markdown, id) {
  const marker = `<!-- rollback:${id} -->`;
  const at = markdown.indexOf(marker);
  if (at < 0) throw new Error('ROLLBACK.md has no marker ' + marker);
  const match = /```sql\r?\n([\s\S]*?)```/.exec(markdown.slice(at));
  if (!match) throw new Error('ROLLBACK.md has no SQL block after ' + marker);
  return match[1];
}

const page = readFileSync(join(root, 'notes/dashboard-migration/design/ROLLBACK.md'), 'utf8');
const rollback010 = rollbackBlock(page, '010');
const rollback009 = rollbackBlock(page, '009');

const schema = 'test_rollback_' + randomUUID().replaceAll('-', '');
const client = new pg.Client({ connectionString: url });
await client.connect();
let created = false;
const scalar = async (sql, args = []) => Object.values((await client.query(sql, args)).rows[0])[0];
const apply = async prefix => {
  const { name, sql } = migrationSql(prefix);
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
    name,
    'rehearsal',
  ]);
  await client.query('COMMIT');
};
const columns = () =>
  scalar(
    `SELECT count(*)::int FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='jobs' AND column_name LIKE 'salary_%'`,
    [schema],
  );
const runsTable = () => scalar('SELECT to_regclass($1) IS NOT NULL', [schema + '.browser_runs']);
const functionCount = () =>
  scalar(
    `SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname=$1 AND p.proname IN
       ('start_browser_run','report_browser_run','finish_browser_run','interrupt_stale_browser_runs')`,
    [schema],
  );
const migrationNames = async () =>
  (await client.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
const baseline = async () => ({
  jobs: await scalar('SELECT count(*)::int FROM jobs'),
  events: await scalar('SELECT count(*)::int FROM job_status_events'),
  evaluations: await scalar('SELECT count(*)::int FROM evaluations'),
  job: (
    await client.query("SELECT company, role, status FROM jobs WHERE url_key='rollback-fixture'")
  ).rows[0],
});

try {
  await client.query('CREATE SCHEMA ' + schema);
  created = true;
  await client.query(`SET search_path TO ${schema}`);
  await client.query(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of files.filter(n => n < '009')) {
    await client.query('BEGIN');
    await client.query(readFileSync(join(migrations, name), 'utf8'));
    await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
      name,
      'rehearsal',
    ]);
    await client.query('COMMIT');
  }
  // Synthetic fixture rows only.
  await client.query(
    "INSERT INTO jobs(company,role,url,url_key) VALUES('Fixture Co','Fixture Role','https://example.invalid/1','rollback-fixture')",
  );
  const jobId = await scalar("SELECT id FROM jobs WHERE url_key='rollback-fixture'");
  await client.query(
    "INSERT INTO job_status_events(job_id,old_status,new_status,actor) VALUES($1,'Pending','Pending','fixture')",
    [jobId],
  );
  const before = await baseline();
  const lastOld = (await migrationNames()).at(-1);

  // Apply 009 and 010, then use them.
  await apply('009');
  await apply('010');
  assert.equal(await columns(), 2);
  assert.ok(await runsTable());
  assert.equal(await functionCount(), 4);
  await client.query('UPDATE jobs SET salary_min=90000, salary_max=120000 WHERE id=$1', [jobId]);
  await assert.rejects(
    client.query('UPDATE jobs SET salary_min=10, salary_max=5 WHERE id=$1', [jobId]),
    /jobs_salary_band_check/,
  );
  const run = (
    await client.query(
      `INSERT INTO browser_runs(request_key,action,job_id,log_ref) VALUES('rehearsal-1','evaluate',$1,'rehearsal.log') RETURNING id`,
      [jobId],
    )
  ).rows[0];
  await client.query('SELECT start_browser_run($1::uuid,$2::integer,now())', [run.id, 4242]);
  assert.equal(await scalar('SELECT state FROM browser_runs WHERE id=$1', [run.id]), 'running');

  // Roll back 010 (documented block), then 009.
  await client.query(rollback010);
  assert.equal(await runsTable(), false);
  assert.equal(await functionCount(), 0);
  assert.equal(await columns(), 2, '009 must still be applied after rolling back 010 only');
  assert.ok(!(await migrationNames()).includes('010_browser_runs.sql'));
  await client.query(rollback009);
  assert.equal(await columns(), 0);
  assert.deepEqual((await migrationNames()).at(-1), lastOld);
  assert.deepEqual(await baseline(), before, 'rollback must not change jobs or history rows');

  // Re-apply: objects return empty and usable.
  await apply('009');
  await apply('010');
  assert.equal(await columns(), 2);
  assert.equal(await scalar('SELECT salary_min FROM jobs WHERE id=$1', [jobId]), null);
  assert.equal(await scalar('SELECT count(*)::int FROM browser_runs'), 0);
  assert.equal(await functionCount(), 4);
  const again = (
    await client.query(
      `INSERT INTO browser_runs(request_key,action,job_id,log_ref) VALUES('rehearsal-2','scan',NULL,'rehearsal2.log') RETURNING id`,
    )
  ).rows[0];
  await client.query('SELECT start_browser_run($1::uuid,$2::integer,now())', [again.id, 4243]);
  assert.equal(await scalar('SELECT state FROM browser_runs WHERE id=$1', [again.id]), 'running');
  assert.deepEqual(await baseline(), before);
  console.log('Rollback rehearsal passed: 009 and 010 applied, rolled back and re-applied');
} finally {
  await client.query('SET search_path TO public').catch(() => {});
  if (created) await client.query('DROP SCHEMA ' + schema + ' CASCADE');
  await client.end();
}
