import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/root.mjs';
import { backfillYoe } from './backfill-yoe.mjs';
import { recordYoe } from '../lib/_job-descriptions.mjs';

process.env.CAREER_OPS_TEST_GUARD = '1';

// Stubbed adapters: no database is reached.
const row = (id, content, role, yoe_min = null, yoe_confidence = null) => ({
  id,
  content,
  role,
  yoe_min,
  yoe_confidence,
});
const stored = [
  row('1', 'You need 5+ years of experience in Go.', 'Engineer'),
  row('2', 'No figures here.', 'Senior Analyst'),
  row('3', 'Nothing at all.', 'Analyst'),
  row('4', '3+ years of SQL.', 'Engineer', 3, 'high'),
];
const run = async (_sql, args) => stored.filter(r => args[1] || r.yoe_confidence === null);
const writes = [];
const inTransaction = async fn => fn({ query: async (_sql, args) => writes.push(args) });

const dry = await backfillYoe({ run, inTransaction });
assert.equal(dry.mode, 'dry-run');
assert.equal(dry.scope, 'unestimated');
assert.equal(dry.scanned, 3);
assert.deepEqual(dry.byConfidence, { high: 1, medium: 0, low: 0, inferred: 1, none: 1 });
assert.equal(dry.changed, 2);
assert.equal(dry.written, 0);
assert.equal(writes.length, 0, 'a dry run never writes');
assert.deepEqual(dry.sample[0], { id: '1', role: 'Engineer', yoe_min: 5, yoe_confidence: 'high' });

const applied = await backfillYoe({ run, inTransaction, apply: true });
assert.equal(applied.written, 2);
assert.deepEqual(writes, [
  ['1', 5, 'high'],
  ['2', 5, 'inferred'],
]);

// --all recomputes rows that already have a value; unchanged rows are not rewritten.
writes.length = 0;
const everything = await backfillYoe({ run, inTransaction, all: true, apply: true });
assert.equal(everything.scanned, 4);
assert.equal(everything.changed, 2);
assert.equal(writes.length, 2);

// A large run samples at most 20 rows, spread over the range.
const many = Array.from({ length: 100 }, (_, i) =>
  row(String(i + 1), '4+ years of work', 'Engineer'),
);
const wide = await backfillYoe({ run: async () => many, inTransaction });
assert.equal(wide.sample.length, 20);
assert.equal(wide.sample[1].id, '6');

// The ingest hook never throws: a failing database leaves the columns alone.
assert.equal(
  await recordYoe('1', '5+ years of Go', 'Engineer', async () => {
    throw new Error('column does not exist');
  }),
  null,
);
const seen = [];
assert.deepEqual(
  await recordYoe('7', '2+ years of Go', 'Engineer', async (_sql, args) => seen.push(args)),
  {
    yoe_min: 2,
    yoe_confidence: 'high',
  },
);
assert.deepEqual(seen[0], ['7', 2, 'high']);
const hostile = {
  toString() {
    throw new Error('parser failure');
  },
};
assert.deepEqual(await recordYoe('7', hostile, 'x', async () => {}), {
  yoe_min: null,
  yoe_confidence: null,
});

// Integration (isolated test database only): ingest hook and backfill against the real schema.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'Backfill unit checks passed; SKIPPED PostgreSQL YOE integration: TEST_DATABASE_URL is required',
  );
  process.exit(0);
}
const { default: pg } = await import('pg');
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');
const schema = 'test_yoe_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
await admin.connect();
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  const dir = join(root, 'infra/sql/migrations');
  for (const name of readdirSync(dir)
    .filter(n => n.endsWith('.sql'))
    .sort())
    await admin.query(readFileSync(join(dir, name), 'utf8'));
  for (const [id, role, content] of [
    [1, 'Senior Engineer', 'No figures in this one.'],
    [2, 'Engineer', 'Requires 4+ years of experience.'],
    [3, 'Analyst', 'Nothing relevant.'],
  ]) {
    await admin.query(
      "INSERT INTO jobs (id,company,role,url,status) VALUES ($1::bigint,'Co',$2,'https://example.test/'||$1::text,'Pending')",
      [id, role],
    );
    await admin.query(
      "INSERT INTO job_descriptions (job_id,content,file_path,content_hash) VALUES ($1,$2,'jds/x.md','h')",
      [id, content],
    );
  }
  const dbRun = async (sql, args) => (await admin.query(sql, args)).rows;
  const dbTx = async fn => {
    await admin.query('BEGIN');
    try {
      const value = await fn(admin);
      await admin.query('COMMIT');
      return value;
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
  };
  const read = async () =>
    (
      await dbRun(
        'SELECT job_id::int AS id, yoe_min, yoe_confidence FROM job_descriptions ORDER BY 1',
        [],
      )
    ).map(r => [r.id, r.yoe_min, r.yoe_confidence]);
  const dryRun = await backfillYoe({ run: dbRun, inTransaction: dbTx });
  assert.equal(dryRun.scanned, 3);
  assert.deepEqual(
    await read(),
    [
      [1, null, null],
      [2, null, null],
      [3, null, null],
    ],
    'dry run writes nothing',
  );
  await backfillYoe({ run: dbRun, inTransaction: dbTx, apply: true });
  assert.deepEqual(await read(), [
    [1, 5, 'inferred'],
    [2, 4, 'high'],
    [3, null, null],
  ]);
  // The hook writes the same columns; the database CHECK accepts them and a bad write is swallowed.
  await recordYoe(3, '2-3 years of experience', 'Analyst', dbRun);
  assert.deepEqual((await read())[2], [3, 2, 'high']);
  const bad = async () => dbRun('UPDATE job_descriptions SET yoe_min = 99', []);
  assert.equal(await recordYoe(3, 'x', 'Analyst', bad), null);
  console.log('YOE backfill and ingest hook integration passed.');
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
