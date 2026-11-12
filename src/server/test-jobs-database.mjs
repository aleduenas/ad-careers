import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/root.mjs';
import { createJobsDetail } from './jobs-detail.mjs';
import { createJobsReader, jobsReadSql } from './jobs-read.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL jobs read integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_jobs_read_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
let pool;
let schemaCreated = false;
const fixtures = [
  {
    id: '9007199254741001',
    revision: '9007199254741003',
    company: 'Ångström Systems',
    role: 'Senior Engineer',
    status: 'Applied',
    score: '4.2',
    source_date: null,
    notes: 'Application notes contain literal 100%_match and café 🚀',
    url: 'https://example.test/large',
  },
  {
    id: '101',
    company: 'Pending Co',
    role: 'Pending role',
    status: 'Pending',
    score: '5.0',
    source_date: '2026-10-05',
    notes: '',
    url: 'https://example.test/pending',
  },
  {
    id: '102',
    company: 'Evaluated Co',
    role: 'Evaluated role',
    status: 'Evaluated',
    score: '3.9',
    source_date: '2026-10-06',
    notes: '',
    url: 'https://example.test/evaluated',
  },
  {
    id: '103',
    company: 'Interview Co',
    role: 'Interview role',
    status: 'Interview',
    score: '4.0',
    source_date: '2026-10-07',
    notes: '',
    url: 'https://example.test/interview',
  },
  {
    id: '104',
    company: 'Offer Co',
    role: 'Offer role',
    status: 'Offer',
    score: '4.5',
    source_date: '2026-10-08',
    notes: '',
    url: 'https://example.test/offer',
  },
  {
    id: '105',
    company: 'Rejected Co',
    role: 'Rejected role',
    status: 'Rejected',
    score: '4.0',
    source_date: '2026-10-09',
    notes: 'Interview occurred before rejection',
    url: 'https://example.test/rejected',
  },
  {
    id: '106',
    company: 'Discarded Co',
    role: 'Discarded role',
    status: 'Discarded',
    score: '3.4',
    source_date: '2026-10-10',
    notes: '',
    url: 'https://example.test/discarded',
  },
  {
    id: '107',
    company: 'Ghosted Co',
    role: 'Ghosted role',
    status: 'Ghosted',
    score: '4.9',
    source_date: '2026-10-11',
    notes: '',
    url: 'https://example.test/ghosted',
  },
  {
    id: '108',
    company: 'Literal Search',
    role: 'Role 108',
    status: 'Evaluated',
    score: '3.0',
    source_date: '2026-10-12',
    notes: 'A second Unicode café 🚀 note',
    url: 'https://example.test/literal',
  },
  {
    id: '109',
    company: 'Stale Cursor',
    role: 'Cursor fixture',
    status: 'Applied',
    score: '2.0',
    source_date: '2026-10-13',
    notes: 'stale cursor fixture',
    url: 'https://example.test/stale',
  },
  {
    id: '112',
    company: 'Unknown Date',
    role: 'Pending without history',
    status: 'Pending',
    score: null,
    source_date: null,
    notes: '',
    url: 'https://example.test/unknown-date',
  },
  {
    id: '113',
    company: 'Stale Cursor Second',
    role: 'Cursor fixture',
    status: 'Applied',
    score: '1.0',
    source_date: '2026-10-13',
    notes: 'stale cursor fixture',
    url: 'https://example.test/stale-second',
  },
];

async function insertFixtures(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO jobs (id,revision,company,role,url,status,score,source_date,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.id,
        row.revision || '0',
        row.company,
        row.role,
        row.url,
        row.status,
        row.score,
        row.source_date,
        row.notes,
      ],
    );
  }
}

async function snapshot(client) {
  const tables = ['jobs', 'job_status_events', 'evaluations', 'job_descriptions'];
  const result = {};
  for (const table of tables) {
    const rows = await client.query(`SELECT * FROM ${table} ORDER BY 1`);
    result[table] = rows.rows;
  }
  return JSON.stringify(result, (_key, value) =>
    value instanceof Date ? value.toISOString() : value,
  );
}

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await admin.query(`SET search_path TO "${schema}"`);
  const migrations = readdirSync(join(root, 'infra/sql/migrations'))
    .filter(name => name.endsWith('.sql'))
    .sort();
  for (const name of migrations)
    await admin.query(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  pool = new pg.Pool({ connectionString: parsed.toString() });
  await insertFixtures(admin, fixtures);

  const large = fixtures[0];
  await admin.query(
    `INSERT INTO jobs (id,company,role,url,status,score,source_date,salary_min,salary_max)
     VALUES ($1,'Manual Salary','Compensation role','https://example.test/salary','Evaluated',4.5,'2026-10-14',
             12345678901234567890.12,12345678901234567999.88)`,
    ['110'],
  );
  await admin.query(
    `INSERT INTO jobs (id,company,role,url,status,score,source_date)
     VALUES (111,'Partial Salary','Partial role','https://example.test/partial','Evaluated',3.5,'2026-10-15')`,
  );
  await admin.query('UPDATE jobs SET salary_min=10.25 WHERE id=111');
  await admin.query(
    `INSERT INTO scan_history (url,first_seen,portal) VALUES
      ($1,'2026-09-25','fixture'),($1,'2026-09-20','fixture'),
      ('https://example.test/evaluated','2020-01-01','fixture')`,
    [large.url],
  );
  await admin.query(
    `INSERT INTO job_status_events (job_id,old_status,new_status,reason,actor,occurred_at)
     VALUES
      ($1,'Evaluated','Applied','Old application','fixture','2025-12-30T12:00:00Z'),
      (106,'Evaluated','Discarded','Older reason','fixture','2026-10-16T12:00:00Z')`,
    [large.id],
  );
  await admin.query(
    `INSERT INTO job_status_events (job_id,old_status,new_status,reason,actor,occurred_at)
     VALUES ($1,'Evaluated','Applied','Toronto boundary','fixture','2026-01-01T02:00:00Z')`,
    [large.id],
  );
  await admin.query(
    `INSERT INTO job_status_events (job_id,old_status,new_status,reason,actor,occurred_at)
     VALUES ($1,'Applied','Applied','Unknown later occurrence','fixture',NULL)`,
    [large.id],
  );
  await admin.query(
    `INSERT INTO job_status_events (job_id,old_status,new_status,reason,actor,occurred_at)
     VALUES (106,'Discarded','Discarded','Latest discard reason','fixture','2026-10-15T12:00:00Z')`,
  );
  await admin.query(
    `INSERT INTO scan_history (url,first_seen,portal) VALUES
      ('https://example.test/pending','2010-01-01','fixture')`,
  );
  await admin.query(
    `INSERT INTO evaluations (job_id,operation_key,score,report_path,result_status)
     VALUES (102,'synthetic-evaluation',3.9,'reports/synthetic.md','Evaluated')`,
  );
  await admin.query(
    `INSERT INTO job_descriptions (job_id,content,file_path,content_hash)
     VALUES (102,'Synthetic description','jds/synthetic.md','synthetic-hash')`,
  );

  const materialCalls = [];
  let readClient = pool;
  const reader = createJobsReader({
    query: async sql => {
      assert.match(sql, /^\s*SELECT\b/i, 'reader SQL must be SELECT-only');
      assert.equal(sql, jobsReadSql, 'reader must issue its reviewed read query');
      return (await readClient.query(sql)).rows;
    },
    resolveMaterials: async rows => {
      materialCalls.push(rows.map(row => String(row.id)));
      return new Map([
        ['102', { cv: true, letter: false }],
        ['108', { cv: false, letter: true }],
      ]);
    },
    readCompensation: async () => ({ text: 'Fixture compensation', state: 'report' }),
    cursorKey: Buffer.alloc(32, 7),
    rootDir: join(root, 'synthetic-root-that-is-never-read'),
  });
  const before = await snapshot(admin);

  const all = await reader.list({ sort: 'company', direction: 'asc', grouped: 'false' });
  assert.equal(
    all.totalCount,
    12,
    'all excludes Pending and includes every other canonical status',
  );
  assert.deepEqual(
    new Set(all.items.map(item => item.status)),
    new Set(['Evaluated', 'Applied', 'Interview', 'Offer', 'Rejected', 'Discarded', 'Ghosted']),
  );
  assert(!all.items.some(item => item.status === 'Pending'));
  assert(
    all.items.every(item => !('notes' in item) && !('reportPath' in item) && !('path' in item)),
  );
  assert.equal(all.items.find(item => item.id === large.id).revision, large.revision);
  assert.equal(all.items.find(item => item.id === large.id).addedDate, '2026-09-20');
  assert.equal(all.items.find(item => item.id === large.id).statusDate, '2025-12-31');
  assert.equal(
    all.items.find(item => item.id === '102').addedDate,
    '2026-10-06',
    'source_date wins over history',
  );
  assert.equal(all.items.find(item => item.id === '106').discardReason, 'Latest discard reason');
  assert.equal(all.items.find(item => item.id === '106').compensation.state, 'report');
  const salary = all.items.find(item => item.id === '110');
  assert.deepEqual(salary.salary, {
    min: '12345678901234567890.12',
    max: '12345678901234567999.88',
    source: 'manual',
  });
  assert.equal(salary.compensation.state, 'manual');
  assert.equal(all.items.find(item => item.id === '111').salary.max, null);

  const pending = await reader.list({ filter: 'pending' });
  assert.equal(pending.totalCount, 2);
  assert.equal(
    pending.items[0].score,
    5,
    'retained Pending score remains available in its own filter',
  );
  assert.equal(pending.items[0].compensation.state, 'notEvaluated');
  assert.equal(
    pending.items.find(item => item.id === '112').addedDate,
    null,
    'unknown dates stay unknown',
  );
  assert.equal(
    (await reader.list({ filter: 'top' })).items.some(item => item.id === '101'),
    false,
  );
  assert.equal(
    (await reader.list({ filter: 'top' })).items.some(item => item.id === '105'),
    true,
  );
  assert.equal(
    (await reader.list({ filter: 'top' })).items.some(item => item.id === '107'),
    false,
  );
  assert.equal(
    (await reader.list({ filter: 'top' })).items.some(item => item.id === '106'),
    false,
  );

  for (const [needle, expected] of [
    ['café 🚀', large.id],
    [large.id, large.id],
    [`#${large.id}`, large.id],
    ['100%_match', large.id],
    ['latest discard reason', '106'],
  ]) {
    const result = await reader.list({ q: needle, grouped: false });
    assert(
      result.items.some(item => item.id === expected),
      `literal search matches ${needle}`,
    );
  }
  assert.equal((await reader.list({ q: '%_', grouped: false })).totalCount, 1);
  assert.equal((await reader.list({ q: 'not present', grouped: false })).totalCount, 0);

  const grouped = await reader.list({
    sort: 'score',
    direction: 'desc',
    grouped: true,
    limit: 200,
  });
  const priority = [
    'Interview',
    'Offer',
    'Applied',
    'Evaluated',
    'Ghosted',
    'Rejected',
    'Discarded',
  ];
  assert.deepEqual(
    grouped.items
      .map(item => item.status)
      .filter((status, i, rows) => i === 0 || status !== rows[i - 1]),
    priority.filter(status => grouped.items.some(item => item.status === status)),
  );
  const evaluated = await reader.list({
    filter: 'evaluated',
    sort: 'company',
    direction: 'asc',
    grouped: false,
  });
  assert.deepEqual(
    evaluated.items.slice(0, 2).map(item => item.id),
    ['102', '108'],
    'material-bearing evaluated rows are promoted in stable sort order',
  );
  assert.deepEqual(evaluated.items[0].materials, { cv: true, letter: false });

  const first = await reader.list({
    filter: 'all',
    sort: 'company',
    direction: 'asc',
    grouped: false,
    limit: 3,
  });
  assert(first.nextCursor);
  const second = await reader.list({
    filter: 'all',
    sort: 'company',
    direction: 'asc',
    grouped: false,
    limit: 3,
    cursor: first.nextCursor,
  });
  assert(second.previousCursor);
  const previous = await reader.list({
    filter: 'all',
    sort: 'company',
    direction: 'asc',
    grouped: false,
    limit: 3,
    cursor: second.previousCursor,
  });
  assert.deepEqual(
    previous.items.map(item => item.id),
    first.items.map(item => item.id),
  );
  await assert.rejects(
    reader.list({
      filter: 'pending',
      sort: 'company',
      direction: 'asc',
      grouped: false,
      limit: 3,
      cursor: first.nextCursor,
    }),
    error => error.statusCode === 400 && Boolean(error.fields?.cursor),
  );
  await assert.rejects(
    reader.list({
      filter: 'all',
      sort: 'company',
      direction: 'asc',
      grouped: false,
      limit: 3,
      cursor: first.nextCursor + 'x',
    }),
    error => error.statusCode === 400 && Boolean(error.fields?.cursor),
  );
  const stale = await reader.list({ q: 'stale cursor fixture', grouped: false, limit: 1 });
  assert(stale.nextCursor);
  const staleTx = await pool.connect();
  try {
    await staleTx.query('BEGIN');
    await staleTx.query('DELETE FROM jobs WHERE id=109');
    readClient = staleTx;
    await assert.rejects(
      reader.list({
        q: 'stale cursor fixture',
        grouped: false,
        limit: 1,
        cursor: stale.nextCursor,
      }),
      error => error.statusCode === 400 && Boolean(error.fields?.cursor),
    );
    await staleTx.query('ROLLBACK');
  } finally {
    readClient = pool;
    staleTx.release();
  }

  const overview = await reader.overview();
  assert.equal(overview.label, 'inferredFromCurrentState');
  assert.equal(overview.metrics.total, 12);
  assert.equal(overview.metrics.byStatus.Applied, 3);
  assert.equal(overview.metrics.byStatus.Interview, 1);
  assert.equal(overview.metrics.byStatus.Offer, 1);
  assert.equal(overview.metrics.byStatus.Rejected, 1);
  assert.equal(overview.metrics.byStatus.Discarded, 1);
  assert.equal(overview.metrics.byStatus.Ghosted, 1);
  assert.equal(overview.metrics.byStatus.Evaluated, 4);
  assert(!('Pending' in overview.metrics.byStatus));
  assert.equal(overview.progress.funnel[0].count, 12);
  assert.equal(overview.progress.funnel[1].count, 7);
  assert.equal(overview.progress.funnel[2].count, 3);
  assert.equal(
    overview.progress.funnel[3].count,
    3,
    'rejected interview evidence is inferred from notes',
  );
  assert.equal(overview.progress.funnel[4].count, 1);
  assert.deepEqual(
    overview.progress.scoreBuckets.map(bucket => bucket.count),
    [4, 3, 2, 2, 2],
    'score buckets include Pending and preserve exact threshold boundaries',
  );
  assert(overview.progress.weeklyActivity.some(item => item.count > 0));
  assert(materialCalls.length > 0);

  // Job detail: SELECT-only reads against the same isolated schema.
  const detailSql = [];
  const detailReader = createJobsDetail({
    query: async (sql, args) => {
      assert.match(sql, /^\s*SELECT\b/i, 'detail SQL must be SELECT-only');
      detailSql.push(sql);
      return (await pool.query(sql, args)).rows;
    },
    rootDir: join(root, 'synthetic-root-that-is-never-read'),
  });
  const evaluatedDetail = await detailReader.detail('102');
  assert.equal(evaluatedDetail.job.company, 'Evaluated Co');
  assert.equal(evaluatedDetail.job.notes, '');
  assert.equal(evaluatedDetail.job.evaluationError, false);
  assert.deepEqual(
    {
      text: evaluatedDetail.jd.text,
      hash: evaluatedDetail.jd.contentHash,
      revision: evaluatedDetail.jd.revision,
    },
    { text: 'Synthetic description', hash: 'synthetic-hash', revision: '1' },
  );
  assert(
    !JSON.stringify(evaluatedDetail).includes('jds/synthetic.md'),
    'JD file path stays private',
  );
  assert(
    !JSON.stringify(evaluatedDetail).includes('reports/synthetic.md'),
    'report path stays private',
  );
  assert.equal(evaluatedDetail.evaluation.history.length, 1);
  assert.equal(evaluatedDetail.evaluation.history[0].score, 3.9);
  assert.equal(evaluatedDetail.evaluation.report.state, 'missing');
  assert.deepEqual(evaluatedDetail.materials, { match: 'none', ambiguous: false, items: [] });
  const bigDetail = await detailReader.detail(large.id);
  assert.equal(bigDetail.job.id, large.id);
  assert.equal(bigDetail.job.revision, large.revision);
  assert.equal(bigDetail.history.length, 3, 'all status events for the job are returned');
  const eventIds = bigDetail.history.map(item => BigInt(item.id));
  assert.deepEqual(
    eventIds,
    [...eventIds].sort((a, b) => (a < b ? -1 : 1)),
  );
  assert(
    bigDetail.history.some(item => item.occurredAt === null),
    'inferred history keeps a null occurrence time',
  );
  const discardedDetail = await detailReader.detail('106');
  assert.equal(discardedDetail.job.discardReason, 'Latest discard reason');
  await assert.rejects(detailReader.detail('999999'), error => error.statusCode === 404);
  await assert.rejects(
    detailReader.detail('9223372036854775808'),
    error => error.statusCode === 404,
  );
  assert(detailSql.length >= 8);

  const after = await snapshot(admin);
  assert.equal(
    after,
    before,
    'read calls leave jobs, status events, evaluations, and JD rows unchanged',
  );
  console.log(
    'PostgreSQL jobs read integration passed: isolated SELECT, status/date/search/order/cursor projections, salary precision, overview formulas, job detail reads and no-write snapshots',
  );
} finally {
  await pool?.end();
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
