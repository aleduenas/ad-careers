import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  findJobByUrl,
  query as databaseQuery,
  transaction as databaseTransaction,
  urlKey,
} from '../lib/_database.mjs';
import { recordYoe, withJobID } from '../lib/_job-descriptions.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

// The three immediate-write operations of Stage 3.2 (STAGE3_EDIT_CONTRACT.md): status change,
// one-field metadata edit, and JD save. Status goes through the SQL transition function with the
// expected revision; metadata uses a field-value guard; the JD is written database first and the
// cache file second. Nothing here starts a worker, and no score is ever a gate.

const ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const REVISION_PATTERN = /^(0|[1-9][0-9]{0,18})$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const MAX_BIGINT = 9223372036854775807n;
const STATUSES = new Set([
  'Applied',
  'Rejected',
  'Interview',
  'Offer',
  'Pending',
  'Evaluated',
  'Discarded',
]);
const FIELDS = new Set(['company', 'role', 'url', 'salaryBand']);
const MAX_FIELD = 300;
const MAX_REASON = 200;
export const MAX_JD_BYTES = 2 * 1024 * 1024;
const JD_RELATIVE = /^data\/jds\/[^\\:]+$/;

function publicError(statusCode, publicCode, message, fields, current) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  if (fields) error.fields = fields;
  if (current !== undefined) error.current = current;
  return error;
}

const invalid = (field, message = 'Request field is invalid.') =>
  publicError(400, 'INVALID_REQUEST', message, { [field]: 'Invalid value.' });
const notFound = () => publicError(404, 'NOT_FOUND', 'Job not found.');

// Control characters (notably NUL, which PostgreSQL rejects) are never meaningful in these fields.
// eslint-disable-next-line no-control-regex
const stripControls = value => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

function compareDecimal(a, b) {
  const split = value => {
    const [whole, fraction = ''] = value.split('.');
    return [BigInt(whole), fraction];
  };
  const [aw, af] = split(a);
  const [bw, bf] = split(b);
  if (aw !== bw) return aw < bw ? -1 : 1;
  const width = Math.max(af.length, bf.length);
  const left = af.padEnd(width, '0');
  const right = bf.padEnd(width, '0');
  return left === right ? 0 : left < right ? -1 : 1;
}

function mapDatabaseFailure(error) {
  if (error?.publicCode || error instanceof DatabaseUnavailableError) return error;
  if (error instanceof SchemaNotReadyError) return error;
  if (error?.code === '42P01' || error?.code === '42703' || error?.code === '42883')
    return new SchemaNotReadyError();
  return new DatabaseUnavailableError();
}

function onlyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw invalid('body', 'Request body must be a JSON object.');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw invalid(key);
}

function checkId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw invalid('id');
  if (BigInt(id) > MAX_BIGINT) throw notFound();
}

function checkRevision(value, field) {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) throw invalid(field);
  if (BigInt(value) > MAX_BIGINT) throw invalid(field);
  return value;
}

function cleanText(value, field, max = MAX_FIELD) {
  if (typeof value !== 'string') throw invalid(field);
  const cleaned = stripControls(value).trim();
  if (!cleaned || [...cleaned].length > max) throw invalid(field);
  return cleaned;
}

function cleanUrl(value) {
  const text = cleanText(value, 'value');
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw invalid('value', 'Enter a full http or https address.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw invalid('value', 'Enter a full http or https address without credentials.');
  return text;
}

function decimalOrNull(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value) || value.length > 40)
    throw invalid(field);
  return value;
}

function safeJdPath(path, id) {
  const normalized = typeof path === 'string' ? path.replaceAll('\\', '/') : '';
  if (
    JD_RELATIVE.test(normalized) &&
    !isAbsolute(normalized) &&
    !normalized.split('/').includes('..') &&
    !normalized.split('/').includes('')
  )
    return normalized;
  return `data/jds/${id}.md`;
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Atomic cache write under data/jds: contained path, no symlink target, temp file then rename.
export async function writeJdCache(rootDir, relativePath, content, fs = nodeFs) {
  const realRoot = await fs.realpath(rootDir);
  const base = resolve(realRoot, 'data', 'jds');
  await fs.mkdir(base, { recursive: true });
  const realBase = await fs.realpath(base);
  if (!inside(realRoot, realBase)) throw new Error('JD cache folder escapes the repository');
  const target = resolve(realRoot, relativePath);
  if (!inside(realBase, target)) throw new Error('JD cache path escapes data/jds');
  await fs.mkdir(dirname(target), { recursive: true });
  if (!inside(realBase, await fs.realpath(dirname(target))))
    throw new Error('JD cache folder escapes data/jds');
  const existing = await fs.lstat(target).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new Error('JD cache target is not a regular file');
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

const iso = value => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};

export function createJobsWrite({
  query = databaseQuery,
  transaction = databaseTransaction,
  detailReader,
  rootDir = repositoryRoot,
  fs = nodeFs,
} = {}) {
  if (typeof query !== 'function' || typeof transaction !== 'function')
    throw new TypeError('Job write adapters must be functions.');
  if (!detailReader || typeof detailReader.detail !== 'function')
    throw new TypeError('jobs-write requires a detailReader with detail().');

  const guarded = async callback => {
    try {
      return await callback();
    } catch (error) {
      throw mapDatabaseFailure(error);
    }
  };

  async function conflict(code, message, id, extra) {
    const current = extra ?? { job: (await detailReader.detail(id)).job };
    return publicError(409, code, message, undefined, current);
  }

  async function changeStatus(id, body) {
    checkId(id);
    onlyKeys(body, ['expectedRevision', 'status', 'reason']);
    const expectedRevision = checkRevision(body.expectedRevision, 'expectedRevision');
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) throw invalid('status');
    if (typeof body.reason !== 'string') throw invalid('reason');
    const reason = stripControls(body.reason).trim();
    if ([...reason].length > MAX_REASON) throw invalid('reason');
    if (body.status === 'Discarded' && !reason)
      throw invalid('reason', 'A reason is required to discard a job.');
    return guarded(async () => {
      try {
        await query('SELECT * FROM change_job_status($1::bigint, $2::bigint, $3, $4, $5)', [
          id,
          expectedRevision,
          body.status,
          reason,
          'browser',
        ]);
      } catch (error) {
        if (error?.code === '40001')
          throw await conflict(
            'REVISION_CONFLICT',
            'The job changed since you loaded it. Review the current state and retry.',
            id,
          );
        if (error?.code === 'P0001' && /does not exist/i.test(error.message ?? ''))
          throw notFound();
        if (error?.code === 'P0001' && /Discard reason/i.test(error.message ?? ''))
          throw invalid('reason', 'A reason is required to discard a job.');
        throw error;
      }
      return { job: (await detailReader.detail(id)).job };
    });
  }

  async function updateMetadata(id, body) {
    checkId(id);
    onlyKeys(body, ['field', 'expectedValue', 'value']);
    if (typeof body.field !== 'string' || !FIELDS.has(body.field)) throw invalid('field');
    let sql;
    let args;
    let newUrl = null;
    if (body.field === 'company' || body.field === 'role') {
      const value = cleanText(body.value, 'value');
      if (typeof body.expectedValue !== 'string') throw invalid('expectedValue');
      const column = body.field === 'company' ? 'company' : 'role';
      sql = `UPDATE jobs SET ${column} = $1, revision = revision + 1, updated_at = now()
             WHERE id = $2::bigint AND ${column} IS NOT DISTINCT FROM $3 RETURNING id`;
      args = [value, id, body.expectedValue];
    } else if (body.field === 'url') {
      const value = cleanUrl(body.value);
      newUrl = value;
      if (body.expectedValue !== null && typeof body.expectedValue !== 'string')
        throw invalid('expectedValue');
      // The job DTO shows the URL normalized by URL(), so the guard also accepts the stored
      // url_key as proof that the caller saw this same address.
      sql = `UPDATE jobs SET url = $1, url_key = $2, revision = revision + 1, updated_at = now()
             WHERE id = $3::bigint
               AND (url IS NOT DISTINCT FROM $4 OR (url_key IS NOT NULL AND url_key = $5))
             RETURNING id`;
      args = [
        value,
        urlKey(value),
        id,
        body.expectedValue,
        body.expectedValue === null ? null : urlKey(body.expectedValue),
      ];
    } else {
      let min = null;
      let max = null;
      if (body.value !== null) {
        if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value))
          throw invalid('value');
        onlyKeysNested(body.value, ['min', 'max'], 'value');
        min = decimalOrNull(body.value.min, 'value');
        max = decimalOrNull(body.value.max, 'value');
        if (min === null || max === null || compareDecimal(min, max) > 0)
          throw invalid('value', 'Enter a minimum that is not above the maximum.');
      }
      const expected = body.expectedValue;
      let expectedMin = null;
      let expectedMax = null;
      if (expected !== null) {
        if (!expected || typeof expected !== 'object' || Array.isArray(expected))
          throw invalid('expectedValue');
        onlyKeysNested(expected, ['min', 'max'], 'expectedValue');
        expectedMin = decimalOrNull(expected.min ?? null, 'expectedValue');
        expectedMax = decimalOrNull(expected.max ?? null, 'expectedValue');
      }
      sql = `UPDATE jobs SET salary_min = $1::numeric, salary_max = $2::numeric,
               revision = revision + 1, updated_at = now()
             WHERE id = $3::bigint AND salary_min IS NOT DISTINCT FROM $4::numeric
               AND salary_max IS NOT DISTINCT FROM $5::numeric RETURNING id`;
      args = [min, max, id, expectedMin, expectedMax];
    }
    return guarded(async () => {
      // Rows stored under an older url_key still count: compare urlKey(url) in JS first.
      if (newUrl !== null && (await findJobByUrl(newUrl, { excludeId: id, query })))
        throw await conflict('URL_IN_USE', 'Another job already uses that URL.', id);
      let updated;
      try {
        updated = await query(sql, args);
      } catch (error) {
        if (error?.code === '23505') {
          throw await conflict('URL_IN_USE', 'Another job already uses that URL.', id);
        }
        if (error?.code === '23514' || error?.code === '22P02' || error?.code === '22003')
          throw invalid('value');
        throw error;
      }
      if (!Array.isArray(updated)) throw new DatabaseUnavailableError();
      if (updated.length === 0) {
        const exists = await query('SELECT id FROM jobs WHERE id = $1::bigint', [id]);
        if (!exists.length) throw notFound();
        throw await conflict(
          'FIELD_CONFLICT',
          'That field changed since you loaded it. Review the current value and retry.',
          id,
        );
      }
      return { job: (await detailReader.detail(id)).job };
    });
  }

  function jdRecord(row) {
    return {
      text: String(row.content),
      contentHash: String(row.content_hash),
      revision: String(row.revision),
      syncedAt: iso(row.synced_at),
    };
  }

  async function saveJd(id, body) {
    checkId(id);
    onlyKeys(body, ['expectedRevision', 'expectedHash', 'text']);
    const expectedRevision = checkRevision(body.expectedRevision, 'expectedRevision');
    if (typeof body.expectedHash !== 'string' || body.expectedHash.length > 64)
      throw invalid('expectedHash');
    if (typeof body.text !== 'string') throw invalid('text');
    const normalized = body.text.replace(/\r\n?/g, '\n');
    if (normalized.includes('\u0000'))
      throw invalid('text', 'The text contains invalid characters.');
    if (!normalized.trim()) throw invalid('text', 'The job description cannot be empty.');
    if (Buffer.byteLength(normalized, 'utf8') > MAX_JD_BYTES)
      throw invalid('text', 'The job description is too large (2 MB limit).');
    let tagged;
    try {
      tagged = withJobID(normalized, id);
    } catch (error) {
      throw invalid(
        'text',
        String(error.message).startsWith('JD belongs') ? error.message : 'Invalid text.',
      );
    }
    const hash = createHash('sha256').update(tagged).digest('hex');
    const committed = await guarded(() =>
      transaction(async client => {
        const run = async (sql, args) => {
          const result = await client.query(sql, args);
          return Array.isArray(result) ? result : (result?.rows ?? []);
        };
        const [job] = await run(
          'SELECT id, jd_path, role FROM jobs WHERE id = $1::bigint FOR UPDATE',
          [id],
        );
        if (!job) throw notFound();
        const [current] = await run(
          'SELECT content, content_hash, revision::text AS revision, file_path, synced_at ' +
            'FROM job_descriptions WHERE job_id = $1::bigint FOR UPDATE',
          [id],
        );
        const currentRevision = current ? String(current.revision) : '0';
        const currentHash = current ? String(current.content_hash) : '';
        if (expectedRevision !== currentRevision || body.expectedHash !== currentHash) {
          throw publicError(
            409,
            'JD_CONFLICT',
            'The job description changed since you loaded it. Your text is kept.',
            undefined,
            current
              ? {
                  text: String(current.content),
                  contentHash: currentHash,
                  revision: currentRevision,
                }
              : { text: null, contentHash: null, revision: '0' },
          );
        }
        const filePath = safeJdPath(current?.file_path ?? job.jd_path, id);
        if (current && current.content === tagged && current.file_path === filePath)
          return { row: current, filePath, changed: false, role: job.role };
        const [row] = await run('SELECT * FROM sync_job_description($1::bigint, $2, $3, $4)', [
          id,
          tagged,
          filePath,
          hash,
        ]);
        return { row, filePath, changed: true, role: job.role };
      }),
    );
    if (committed.changed) {
      // D116: refresh the years-of-experience estimate after the commit; never fails the edit.
      try {
        await recordYoe(id, tagged, committed.role, query);
      } catch {
        // The estimate is optional; the saved text stands.
      }
    }
    let cacheSync = 'ok';
    try {
      await writeJdCache(rootDir, committed.filePath, tagged, fs);
    } catch {
      // The database commit stands; the caller is told the cache file was not updated.
      cacheSync = 'error';
    }
    const detail = await guarded(() => detailReader.detail(id));
    return {
      job: detail.job,
      jd: jdRecord(committed.row),
      cacheSync,
    };
  }

  // The favorite flag is a label: one idempotent UPDATE of that column only. No revision check,
  // no revision bump and no status event, so it never conflicts with an open edit.
  async function setFavorite(id, body) {
    checkId(id);
    onlyKeys(body, ['favorite']);
    if (typeof body.favorite !== 'boolean') throw invalid('favorite');
    return guarded(async () => {
      const rows = await query(
        'UPDATE jobs SET favorite = $2 WHERE id = $1::bigint RETURNING id::text AS id, favorite',
        [id, body.favorite],
      );
      const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
      if (!row) throw notFound();
      return { id: String(row.id), favorite: row.favorite === true };
    });
  }

  return Object.freeze({ changeStatus, updateMetadata, saveJd, setFavorite });
}

function onlyKeysNested(value, allowed, field) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw invalid(field);
}
