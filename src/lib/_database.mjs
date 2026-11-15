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
    throw new Error('Database not configured. Set POSTGRES_PASSWORD in .env; see infra/README.md.');
  return {
    host: '127.0.0.1',
    port: Number(env.POSTGRES_PORT || 54329),
    database: 'career_ops',
    user: 'career_ops',
    password: env.POSTGRES_PASSWORD,
  };
}
let pool;
// A server-side disconnect (a PostgreSQL restart, pg_terminate_backend, a network drop) emits
// 'error' on the idle or checked-out client and on the pool. With no listener Node would crash the
// whole process. The failed client is already discarded by the pool, so the next query connects
// afresh. The loss is logged once per outage, with the error code only: never the message, the
// connection string or any credential.
let outageReported = false;
function onConnectionError(error) {
  if (outageReported) return;
  outageReported = true;
  const code =
    typeof error?.code === 'string' && /^[0-9A-Za-z_]{1,16}$/.test(error.code)
      ? error.code
      : 'unknown';
  console.error('Database connection lost (' + code + '); the next query reconnects.');
}
// Test guard: with CAREER_OPS_TEST_GUARD=1 a connection to any database whose name does not start
// with career_ops_test_ is refused before it is attempted, so a test that falls back to the
// configured (personal) database fails loudly instead of touching it.
export function assertTestDatabase(config = databaseConfig(), env = process.env) {
  if (env.CAREER_OPS_TEST_GUARD !== '1') return;
  let name = '';
  try {
    name = config.connectionString
      ? decodeURIComponent(new URL(config.connectionString).pathname.replace(/^\//, ''))
      : String(config.database ?? '');
  } catch {
    name = '';
  }
  if (!/^career_ops_test_[a-z0-9_]+$/.test(name))
    throw new Error(
      'Test guard: refusing to connect to a database that is not career_ops_test_*. ' +
        'Tests must use node src/helpers/db-test.mjs or inject their own readers.',
    );
}
export function db() {
  if (pool) return pool;
  assertTestDatabase();
  const created = new pg.Pool({
    ...databaseConfig(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    allowExitOnIdle: true,
  });
  created.on('error', onConnectionError);
  // Also covers clients that are checked out when the connection drops.
  created.on('connect', client => client.on('error', onConnectionError));
  return (pool = created);
}
export async function query(sql, args = []) {
  const rows = (await db().query(sql, args)).rows;
  outageReported = false;
  return rows;
}
export async function transaction(fn) {
  const client = await db().connect();
  let broken;
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (e) {
    // A dead connection cannot roll back; keep the original error and drop the client.
    await client.query('ROLLBACK').catch(rollbackError => {
      broken = rollbackError;
    });
    throw e;
  } finally {
    client.release(broken);
  }
}
// Query parameters that only identify a campaign or referrer. Meaningful ones (gh_jid, jobId,
// career_job_req_id, token, for) are kept because they select the posting.
const TRACKING_PARAM = /^(jr_id|source|src|gh_src|ref|lever-source|utm_.*)$/;
// The key this function produced before fragments, tracking parameters and Workday locale
// segments were dropped. Rows written earlier keep that key in jobs.url_key, so lookups against
// the stored column must try both.
export function legacyUrlKey(url) {
  return (
    (typeof url === 'string' ? url : undefined)
      ?.replace(/^https?:\/\/(www\.)?/, '')
      .replace(/[)\].,;]+$/, '')
      .replace(/\/+$/, '')
      .toLowerCase() || null
  );
}
export function urlKey(url) {
  if (typeof url !== 'string' || !url) return null;
  let rest = url.replace(/^https?:\/\/(www\.)?/, '');
  // Hash-routed careers sites (`#/job/1`, `#!/job/1`) keep the fragment; every other one is dropped.
  const hash = rest.indexOf('#');
  const fragment = hash !== -1 && /^#!?\//.test(rest.slice(hash)) ? rest.slice(hash) : '';
  if (hash !== -1) rest = rest.slice(0, hash);
  const q = rest.indexOf('?');
  let head = q === -1 ? rest : rest.slice(0, q);
  const params = q === -1 ? [] : rest.slice(q + 1).split('&');
  const kept = params.filter(p => {
    if (!p) return false;
    const [name, ...value] = p.split('=');
    const lowered = name.toLowerCase();
    if (TRACKING_PARAM.test(lowered)) return false;
    return !(lowered === 'l' && value.join('=') === '');
  });
  head = head.replace(/^([^/]*\.myworkdayjobs\.com)\/[a-z]{2}-[a-z]{2}(?=\/)/i, '$1');
  const joined = (kept.length ? `${head}?${kept.join('&')}` : head) + fragment;
  return (
    joined
      .replace(/[)\].,;]+$/, '')
      .replace(/\/+$/, '')
      .toLowerCase() || null
  );
}
// Finds the tracked job for a URL by comparing urlKey(jobs.url) in JS, so rows stored under an
// older key (tracking parameter, fragment, Workday locale) are still found. The jobs table is
// small and single-user, so a full read is fine. `run` is an injectable query function.
export async function findJobByUrl(url, { excludeId = null, query: run = query } = {}) {
  const key = urlKey(url);
  if (!key) return null;
  const rows = await run(
    'SELECT id::text AS id, company, role, status, url, url_key FROM jobs WHERE url IS NOT NULL',
  );
  if (!Array.isArray(rows)) return null;
  return (
    rows.find(
      row =>
        (excludeId === null || String(row.id) !== String(excludeId)) &&
        (urlKey(row.url) === key || row.url_key === key),
    ) ?? null
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
