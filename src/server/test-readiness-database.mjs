import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { root } from '../lib/root.mjs';
import { createReadinessCheck } from './readiness.mjs';

// Runs the real readiness catalog SQL against an isolated schema of the disposable test
// database. Injected-query tests cannot catch type errors in that SQL (for example text[] <@ name[]
// on PostgreSQL 17), so this is the test that proves it executes.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL readiness integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_ready_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await admin.query(`SET search_path TO "${schema}"`);
  const migrations = readdirSync(join(root, 'infra/sql/migrations'))
    .filter(name => name.endsWith('.sql'))
    .sort();
  for (const name of migrations)
    await admin.query(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));

  const query = async (sql, args = []) => (await admin.query(sql, args)).rows;
  const check = createReadinessCheck({ query, schema });
  assert.deepEqual(await check(), { ready: true, database: 'ready', schema: 'ready' });

  // A real SQL error is a schema problem with the driver error kept as the cause, not
  // "unavailable".
  await assert.rejects(
    createReadinessCheck({
      query: sql => query(sql + ' AND nonexistent_column = 1', [schema]),
      schema,
    })(),
    error => error.name === 'SchemaNotReadyError' && typeof error.cause?.code === 'string',
  );

  // A missing required object is SchemaNotReadyError.
  await admin.query(
    `ALTER TABLE "${schema}".scan_history RENAME COLUMN first_seen TO first_seen_x`,
  );
  await assert.rejects(check(), { name: 'SchemaNotReadyError' });
  await admin.query(
    `ALTER TABLE "${schema}".scan_history RENAME COLUMN first_seen_x TO first_seen`,
  );
  assert.equal((await check()).ready, true);

  // A connection failure is DatabaseUnavailableError.
  const dead = new URL(url);
  dead.port = '1';
  const deadPool = new pg.Pool({
    connectionString: dead.toString(),
    connectionTimeoutMillis: 1500,
  });
  deadPool.on('error', () => {});
  try {
    await assert.rejects(
      createReadinessCheck({ query: async sql => (await deadPool.query(sql)).rows, schema })(),
      { name: 'DatabaseUnavailableError' },
    );
  } finally {
    await deadPool.end().catch(() => {});
  }
  console.log('PostgreSQL readiness integration passed');
} finally {
  if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
