import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './root.mjs';
export { root };
export function databaseConfig() {
  const file = join(root, '.env');
  const values = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .filter(l => /^[A-Z_]+=/.test(l))
          .map(l => {
            const i = l.indexOf('=');
            return [l.slice(0, i), l.slice(i + 1)];
          }),
      )
    : {};
  const env = { ...values, ...process.env };
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };
  if (!env.POSTGRES_PASSWORD)
    throw new Error(
      'Database not configured. Set POSTGRES_PASSWORD in .env; see documentation/guides/database.md.',
    );
  return {
    host: '127.0.0.1',
    port: Number(env.POSTGRES_PORT || 54329),
    database: 'career_ops',
    user: 'career_ops',
    password: env.POSTGRES_PASSWORD,
  };
}
let pool;
export function db() {
  return (pool ??= new pg.Pool({
    ...databaseConfig(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    allowExitOnIdle: true,
  }));
}
export async function query(sql, args = []) {
  return (await db().query(sql, args)).rows;
}
export async function transaction(fn) {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export function urlKey(url) {
  return (
    url
      ?.replace(/^https?:\/\/(www\.)?/, '')
      .replace(/[)\].,;]+$/, '')
      .replace(/\/+$/, '')
      .toLowerCase() || null
  );
}
export async function createJob({
  company,
  role,
  url,
  jd_path = null,
  source_date = new Date().toISOString().slice(0, 10),
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source_date)) throw new Error('source_date must be YYYY-MM-DD');
  const jd = jd_path ? (await import('./_job-descriptions.mjs')).readJDFile(jd_path) : null;
  const result = await transaction(async c => {
    const job = (
      await c.query('SELECT * FROM create_job($1,$2,$3,$4,$5,$6::date)', [
        company,
        role,
        url,
        urlKey(url),
        jd_path,
        source_date,
      ])
    ).rows[0];
    if (jd) {
      const tagged = (await import('./_job-descriptions.mjs')).withJobID(jd.content, job.id);
      await c.query('SELECT sync_job_description($1,$2,$3,$4)', [
        job.id,
        tagged,
        jd.file_path,
        createHash('sha256').update(tagged).digest('hex'),
      ]);
    }
    return job;
  });
  if (jd_path) await (await import('./_job-descriptions.mjs')).syncJD(result.id, jd_path);
  return result;
}
export async function getJob(id) {
  const j = (await query('SELECT * FROM jobs WHERE id=$1', [id]))[0];
  if (!j) throw new Error('Unknown job ' + id);
  return j;
}
export async function close() {
  await pool?.end();
  pool = null;
}
