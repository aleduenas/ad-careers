import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { urlKey } from '../lib/_database.mjs';
import { root } from '../lib/root.mjs';
import { createGhosting } from './ghosting.mjs';
import { createJobsDetail } from './jobs-detail.mjs';
import { createJobsWrite } from './jobs-write.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL job writes integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_jobs_write_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
const sha = text => createHash('sha256').update(text).digest('hex');
let pool;
let schemaCreated = false;
let rootDir;

const reject = async (promise, check) => {
  await assert.rejects(promise, error => {
    check(error);
    return true;
  });
};

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
  pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 8 });
  const rows = async (sql, args = []) => (await pool.query(sql, args)).rows;
  const transaction = async fn => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  rootDir = await mkdtemp(join(tmpdir(), 'career-ops-writes-db-'));
  const detail = createJobsDetail({ query: rows, rootDir });
  const writer = createJobsWrite({ query: rows, transaction, detailReader: detail, rootDir });
  const newJob = async (company, role, link) =>
    (
      await rows('SELECT * FROM create_job($1,$2,$3,$4,NULL,$5::date)', [
        company,
        role,
        link,
        urlKey(link),
        '2026-10-01',
      ])
    )[0];
  const otherTables = async () =>
    JSON.stringify([
      await rows('SELECT * FROM evaluations ORDER BY id'),
      await rows('SELECT * FROM workflow_claims ORDER BY resource'),
      await rows('SELECT * FROM browser_runs ORDER BY id'),
    ]);
  const untouched = await otherTables();

  // Status: every allowed transition through the real function.
  const job = await newJob('Acme', 'Engineer', 'https://example.test/status');
  const id = String(job.id);
  let revision = String(job.revision);
  const apply = async (status, reason = '') => {
    const result = await writer.changeStatus(id, { expectedRevision: revision, status, reason });
    assert.equal(result.job.status, status);
    assert.notEqual(result.job.revision, revision);
    assert.equal(BigInt(result.job.revision), BigInt(revision) + 1n, 'revision advances by one');
    revision = result.job.revision;
    return result.job;
  };
  let after = await apply('Evaluated');
  after = await apply('Applied', 'Sent via portal');
  assert.match(after.notes, /Sent via portal/, 'the reason is appended to notes');
  const appliedAt = (await rows('SELECT applied_at FROM jobs WHERE id=$1', [id]))[0].applied_at;
  assert.ok(appliedAt, 'applied_at is set when moving to Applied');
  await apply('Interview');
  await apply('Offer');
  await apply('Rejected', 'Went another way');
  await apply('Pending');
  await apply('Applied');
  // change_job_status sets applied_at = now() on every move into Applied from another status.
  const reapplied = (await rows('SELECT applied_at FROM jobs WHERE id=$1', [id]))[0].applied_at;
  assert.ok(
    new Date(reapplied).getTime() >= new Date(appliedAt).getTime(),
    'a later move back to Applied sets a new applied_at, not earlier than the first',
  );
  await apply('Evaluated');

  // Discard-reason rule: the API rejects a blank reason and the SQL function enforces it too.
  await reject(
    writer.changeStatus(id, { expectedRevision: revision, status: 'Discarded', reason: '  ' }),
    error => assert.equal(error.statusCode, 400),
  );
  await assert.rejects(
    rows("SELECT * FROM change_job_status($1::bigint,$2::bigint,'Discarded','','browser')", [
      id,
      revision,
    ]),
    /Discard reason is required/,
  );
  after = await apply('Discarded', 'Wrong location');
  assert.equal(after.discardReason, 'Wrong location');

  // Events carry the browser actor and the transition history is complete and ordered.
  const events = await rows(
    'SELECT old_status,new_status,reason,actor FROM job_status_events WHERE job_id=$1 ORDER BY id',
    [id],
  );
  assert.deepEqual(
    events.map(e => e.new_status),
    [
      'Evaluated',
      'Applied',
      'Interview',
      'Offer',
      'Rejected',
      'Pending',
      'Applied',
      'Evaluated',
      'Discarded',
    ],
  );
  assert.ok(events.every(e => e.actor === 'browser'));
  assert.equal(events.at(-1).reason, 'Wrong location');

  // Stale revision: 409 with the current job; nothing changes.
  const stale = String(BigInt(revision) - 1n);
  await reject(
    writer.changeStatus(id, { expectedRevision: stale, status: 'Offer', reason: '' }),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, 'REVISION_CONFLICT');
      assert.equal(error.current.job.status, 'Discarded');
      assert.equal(error.current.job.revision, revision);
    },
  );
  await reject(
    writer.changeStatus('999999', { expectedRevision: '0', status: 'Offer', reason: '' }),
    error => assert.equal(error.statusCode, 404),
  );
  assert.equal((await rows('SELECT status FROM jobs WHERE id=$1', [id]))[0].status, 'Discarded');

  // Metadata edits with the field-value guard.
  const first = await newJob('Meta Co', 'Analyst', 'https://example.test/meta-1');
  const second = await newJob('Meta Two', 'Analyst', 'https://example.test/meta-2');
  const mid = String(first.id);
  let result = await writer.updateMetadata(mid, {
    field: 'company',
    expectedValue: 'Meta Co',
    value: '  Meta Corp ',
  });
  assert.equal(result.job.company, 'Meta Corp');
  assert.equal(BigInt(result.job.revision), BigInt(first.revision) + 1n);
  await reject(
    writer.updateMetadata(mid, { field: 'company', expectedValue: 'Meta Co', value: 'Other' }),
    error => {
      assert.equal(error.publicCode, 'FIELD_CONFLICT');
      assert.equal(error.current.job.company, 'Meta Corp');
    },
  );
  // A status change elsewhere does not block an unrelated field edit.
  await writer.changeStatus(mid, {
    expectedRevision: result.job.revision,
    status: 'Evaluated',
    reason: '',
  });
  result = await writer.updateMetadata(mid, {
    field: 'role',
    expectedValue: 'Analyst',
    value: 'Senior Analyst',
  });
  assert.equal(result.job.role, 'Senior Analyst');
  assert.equal(result.job.status, 'Evaluated');

  // URL edit keeps url_key in step and enforces uniqueness.
  result = await writer.updateMetadata(mid, {
    field: 'url',
    expectedValue: 'https://example.test/meta-1',
    value: 'https://www.Example.test/Meta-New/',
  });
  assert.equal(
    result.job.url,
    'https://www.example.test/Meta-New/',
    'the DTO shows the normalized URL',
  );
  assert.equal(
    (await rows('SELECT url FROM jobs WHERE id=$1', [mid]))[0].url,
    'https://www.Example.test/Meta-New/',
    'the stored URL is exactly as typed',
  );
  assert.equal(
    (await rows('SELECT url_key FROM jobs WHERE id=$1', [mid]))[0].url_key,
    'example.test/meta-new',
  );
  await reject(
    writer.updateMetadata(mid, {
      field: 'url',
      expectedValue: 'https://www.example.test/Meta-New/',
      value: 'https://example.test/meta-2',
    }),
    error => {
      assert.equal(error.publicCode, 'URL_IN_USE');
      assert.equal(error.current.job.url, 'https://www.example.test/Meta-New/');
    },
  );
  assert.equal(
    (await rows('SELECT url_key FROM jobs WHERE id=$1', [mid]))[0].url_key,
    'example.test/meta-new',
    'a rejected URL leaves url_key alone',
  );
  assert.equal(String(second.id) === mid, false);

  // Salary: set, partial-pair guard, exact large decimals, clear.
  result = await writer.updateMetadata(mid, {
    field: 'salaryBand',
    expectedValue: null,
    value: { min: '12345678901234567890.12', max: '12345678901234567999.88' },
  });
  assert.deepEqual(result.job.salary, {
    min: '12345678901234567890.12',
    max: '12345678901234567999.88',
    source: 'manual',
  });
  await reject(
    writer.updateMetadata(mid, {
      field: 'salaryBand',
      expectedValue: null,
      value: { min: '1', max: '2' },
    }),
    error => assert.equal(error.publicCode, 'FIELD_CONFLICT'),
  );
  result = await writer.updateMetadata(mid, {
    field: 'salaryBand',
    expectedValue: { min: '12345678901234567890.12', max: '12345678901234567999.88' },
    value: { min: '100000', max: '130000' },
  });
  assert.equal(result.job.salary.min, '100000');
  result = await writer.updateMetadata(mid, {
    field: 'salaryBand',
    expectedValue: { min: '100000', max: '130000' },
    value: null,
  });
  assert.equal(result.job.salary, null, 'null clears both columns');
  const cleared = (await rows('SELECT salary_min, salary_max FROM jobs WHERE id=$1', [mid]))[0];
  assert.deepEqual([cleared.salary_min, cleared.salary_max], [null, null]);

  // JD: no row yet, then revision and hash progression, unchanged text, conflict, cache file.
  const third = await newJob('JD Co', 'Writer', 'https://example.test/jd');
  const jid = String(third.id);
  const tag = `\n<!-- career-ops-job-id: ${jid} -->\n`;
  let saved = await writer.saveJd(jid, {
    expectedRevision: '0',
    expectedHash: '',
    text: 'First text.\r\nSecond line.',
  });
  const firstContent = `First text.\nSecond line.\n${tag}`;
  assert.deepEqual(
    [saved.jd.text, saved.jd.contentHash, saved.jd.revision, saved.cacheSync],
    [firstContent, sha(firstContent), '1', 'ok'],
  );
  assert.equal(await readFile(join(rootDir, 'data', 'jds', `${jid}.md`), 'utf8'), firstContent);
  assert.equal(
    (await rows('SELECT jd_path FROM jobs WHERE id=$1', [jid]))[0].jd_path,
    `data/jds/${jid}.md`,
  );
  const unchanged = await writer.saveJd(jid, {
    expectedRevision: '1',
    expectedHash: sha(firstContent),
    text: 'First text.\nSecond line.',
  });
  assert.equal(unchanged.jd.revision, '1', 'unchanged text does not advance the revision');
  assert.equal(unchanged.jd.contentHash, sha(firstContent));
  saved = await writer.saveJd(jid, {
    expectedRevision: '1',
    expectedHash: sha(firstContent),
    text: 'Edited text.',
  });
  const secondContent = `Edited text.\n${tag}`;
  assert.deepEqual([saved.jd.revision, saved.jd.contentHash], ['2', sha(secondContent)]);
  await reject(
    writer.saveJd(jid, {
      expectedRevision: '1',
      expectedHash: sha(firstContent),
      text: 'Late edit',
    }),
    error => {
      assert.equal(error.publicCode, 'JD_CONFLICT');
      assert.deepEqual(error.current, {
        text: secondContent,
        contentHash: sha(secondContent),
        revision: '2',
      });
    },
  );
  await reject(
    writer.saveJd(jid, { expectedRevision: '2', expectedHash: 'wrong', text: 'Late edit' }),
    error => assert.equal(error.publicCode, 'JD_CONFLICT'),
  );
  await reject(
    writer.saveJd(jid, {
      expectedRevision: '2',
      expectedHash: sha(secondContent),
      text: 'x\n<!-- career-ops-job-id: 1 -->',
    }),
    error => assert.equal(error.statusCode, 400),
  );
  const stored = (await rows('SELECT * FROM job_descriptions WHERE job_id=$1', [jid]))[0];
  assert.equal(stored.content, secondContent, 'conflicts and rejections left the stored JD alone');
  assert.equal(String(stored.revision), '2');
  assert.equal(
    (await detail.detail(jid)).jd.text,
    secondContent,
    'the detail read sees the saved JD',
  );

  // Ghosting boundary, through the real function and scheduler pass.
  const make = async (label, status, appliedExpr) => {
    const created = await newJob('Ghost ' + label, 'Role', `https://example.test/ghost-${label}`);
    await rows(`UPDATE jobs SET status=$2, applied_at=${appliedExpr} WHERE id=$1`, [
      created.id,
      status,
    ]);
    return String(created.id);
  };
  const ghostedJob = await make('stale', 'Applied', "now() - interval '40 days 1 minute'");
  const wellPast = await make('past', 'Applied', "now() - interval '90 days'");
  const edge = await make('edge', 'Applied', "now() - interval '39 days 23 hours'");
  const recent = await make('recent', 'Applied', "now() - interval '2 days'");
  const nullApplied = await make('null', 'Applied', 'NULL');
  const interview = await make('interview', 'Interview', "now() - interval '100 days'");
  const rejected = await make('rejected', 'Rejected', "now() - interval '100 days'");
  const logs = [];
  const ghosting = createGhosting({
    query: rows,
    readiness: async () => {},
    log: message => logs.push(message),
  });
  const statusOf = async jobId =>
    (await rows('SELECT status, revision FROM jobs WHERE id=$1', [jobId]))[0];
  const beforeRevision = (await statusOf(ghostedJob)).revision;
  assert.equal(await ghosting.runOnce(), 2);
  assert.deepEqual(logs, ['Ghosting: 2 stale applications moved to Ghosted.']);
  for (const moved of [ghostedJob, wellPast])
    assert.equal((await statusOf(moved)).status, 'Ghosted');
  for (const kept of [edge, recent, nullApplied])
    assert.equal((await statusOf(kept)).status, 'Applied');
  assert.equal((await statusOf(interview)).status, 'Interview');
  assert.equal((await statusOf(rejected)).status, 'Rejected');
  assert.equal(BigInt((await statusOf(ghostedJob)).revision), BigInt(beforeRevision) + 1n);
  const ghostEvent = (
    await rows('SELECT old_status,new_status,reason,actor FROM job_status_events WHERE job_id=$1', [
      ghostedJob,
    ])
  )[0];
  assert.deepEqual(ghostEvent, {
    old_status: 'Applied',
    new_status: 'Ghosted',
    reason: 'No response 40 days after application',
    actor: 'dashboard-auto',
  });
  assert.equal(await ghosting.runOnce(), 0, 'a second pass moves nothing');
  assert.equal(logs.at(-1), 'Ghosting: 0 stale applications moved to Ghosted.');
  // A ghosted job shows through the detail read like any other status.
  assert.equal((await detail.detail(ghostedJob)).job.status, 'Ghosted');
  // The scheduler skips quietly when readiness fails.
  const down = createGhosting({
    query: rows,
    readiness: async () => {
      throw new Error('not ready');
    },
    log: message => logs.push(message),
  });
  assert.equal(await down.runOnce(), null);
  assert.equal(logs.at(-1), 'Ghosting: skipped (database not ready).');

  // D114 favorite: a label only. Revision, status, score and status favEvents never change.
  const fav = await newJob('Acme', 'Favorite', 'https://example.test/favorite');
  const favId = String(fav.id);
  const favEvents = async () =>
    (await rows('SELECT count(*)::int AS n FROM job_status_events WHERE job_id=$1', [favId]))[0].n;
  const favSnapshot = async () =>
    JSON.stringify(
      (await rows('SELECT status, score, revision::text FROM jobs WHERE id=$1', [favId]))[0],
    );
  assert.equal((await detail.detail(favId)).job.favorite, false, 'default is not a favorite');
  const favEventsBefore = await favEvents();
  const favStateBefore = await favSnapshot();
  assert.deepEqual(await writer.setFavorite(favId, { favorite: true }), {
    id: favId,
    favorite: true,
  });
  assert.deepEqual(await writer.setFavorite(favId, { favorite: true }), {
    id: favId,
    favorite: true,
  });
  assert.equal((await detail.detail(favId)).job.favorite, true);
  assert.equal(await favSnapshot(), favStateBefore, 'status, score and revision are unchanged');
  assert.equal(await favEvents(), favEventsBefore, 'no status event is written');
  const favStatus = await writer.changeStatus(favId, {
    expectedRevision: String(fav.revision),
    status: 'Evaluated',
    reason: '',
  });
  assert.equal(favStatus.job.favorite, true, 'a status change keeps the flag');
  assert.deepEqual(await writer.setFavorite(favId, { favorite: false }), {
    id: favId,
    favorite: false,
  });
  await reject(writer.setFavorite('987654321', { favorite: true }), error =>
    assert.equal(error.statusCode, 404),
  );

  assert.equal(await otherTables(), untouched, 'no evaluation, claim or run row was touched');
  console.log(
    'PostgreSQL job writes passed: every status transition and discard rule, revision and field conflicts, URL uniqueness and url_key, salary clear, favorite flag as a pure label, JD revision/hash progression and cache file, ghosting boundary',
  );
} finally {
  await pool?.end().catch(() => {});
  if (rootDir) await rm(rootDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await admin.end().catch(() => {});
}
