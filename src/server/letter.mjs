import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { query as databaseQuery } from '../lib/_database.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { jobDetailSql, LETTER_MAX_BYTES } from './jobs-detail.mjs';
import { resolveJobMaterialDetail } from './jobs-materials.mjs';
import { inspectSafeFile } from './jobs-paths.mjs';

// Letter editing for Stage 3.5 (STAGE3_LETTER_CONTRACT.md): read and save exactly the file
// cover-letter.md in the job's matched output folder, guarded by the sha256 of its bytes. Nothing
// is created (a job without the file has no editor), nothing outside the matched folder is touched
// and saving never starts a run or a render. Publication is a run (runs.mjs) that asks this
// service for the same snapshot so the PDF is made from exactly the hash the user saved.

export { LETTER_MAX_BYTES };
export const LETTER_NAME = 'cover-letter.md';
const PDF_NAME = 'cover-letter.pdf';
const ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_BIGINT = 9223372036854775807n;
const BLOCKING_ACTIONS = ['letter', 'publish'];

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
const notFound = () => publicError(404, 'NOT_FOUND', 'Job or cover letter not found.');

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// CRLF and lone CR become LF.
export const normalizeLetterText = text => String(text).replace(/\r\n?/g, '\n');

// Non-blank, at most 256 KB of UTF-8 after normalizing, and no control characters other than tab
// and newline. Returns the normalized text.
export function validateLetterText(text) {
  if (typeof text !== 'string') throw invalid('text');
  const normalized = normalizeLetterText(text);
  if (normalized.trim() === '')
    throw publicError(400, 'INVALID_REQUEST', 'The letter cannot be blank.', {
      text: 'The letter cannot be blank.',
    });
  if (Buffer.byteLength(normalized, 'utf8') > LETTER_MAX_BYTES)
    throw publicError(400, 'INVALID_REQUEST', 'The letter is too long (256 KB maximum).', {
      text: 'The letter is too long (256 KB maximum).',
    });
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(normalized))
    throw publicError(400, 'INVALID_REQUEST', 'The letter contains control characters.', {
      text: 'The letter contains control characters.',
    });
  return normalized;
}

export function createLetterService({
  query = databaseQuery,
  resolveMaterials = resolveJobMaterialDetail,
  rootDir = repositoryRoot,
  fs = nodeFs,
} = {}) {
  for (const adapter of [query, resolveMaterials])
    if (typeof adapter !== 'function') throw new TypeError('Letter adapters must be functions.');

  async function select(sql, id, { missingTable = false } = {}) {
    try {
      const rows = await query(sql, [id]);
      if (!Array.isArray(rows)) throw new DatabaseUnavailableError();
      return rows;
    } catch (error) {
      if (error instanceof DatabaseUnavailableError || error instanceof SchemaNotReadyError)
        throw error;
      if (missingTable && error?.code === '42P01') return [];
      if (error?.code === '42P01' || error?.code === '42703') throw new SchemaNotReadyError();
      throw new DatabaseUnavailableError();
    }
  }

  // One mutex for every operation that decides on the letter file. The run service wraps its
  // publish dispatch in it too, so a save cannot slip between the hash check and the run row.
  let chain = Promise.resolve();
  const exclusive = callback => {
    const run = chain.then(callback, callback);
    chain = run.catch(() => {});
    return run;
  };

  // The matched folder's cover-letter.md, or null. Only an id or legacy match with a single
  // candidate, and only the exact file name, qualifies.
  async function locate(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw invalid('id');
    if (BigInt(id) > MAX_BIGINT) throw notFound();
    const [row] = await select(jobDetailSql.job, id);
    if (!row) throw notFound();
    const resolved = await resolveMaterials(row, rootDir);
    if (
      !resolved?.dir ||
      resolved.ambiguous ||
      !['id', 'legacy'].includes(resolved.match) ||
      resolved.files?.letter?.name !== LETTER_NAME
    )
      return null;
    const realRoot = await fs.realpath(rootDir).catch(() => null);
    if (!realRoot) return null;
    const inspect = name =>
      inspectSafeFile(rootDir, relative(realRoot, join(resolved.dir, name)), ['output']);
    const file = await inspect(LETTER_NAME);
    if (file?.status !== 'ok') return null;
    return { id, path: file.path, dir: dirname(file.path), inspect };
  }

  // Current bytes of the located file as {editable, text, contentHash}. A file above the cap or
  // that is not valid UTF-8 is listed but not editable (no text, no hash).
  async function snapshotOf(located) {
    const info = await fs.stat(located.path).catch(() => null);
    if (!info || !info.isFile()) throw notFound();
    if (info.size > LETTER_MAX_BYTES) return { editable: false, text: '', contentHash: '' };
    let bytes;
    try {
      bytes = await fs.readFile(located.path);
    } catch {
      throw notFound();
    }
    if (bytes.length > LETTER_MAX_BYTES) return { editable: false, text: '', contentHash: '' };
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { editable: true, text, contentHash: sha256(bytes) };
    } catch {
      return { editable: false, text: '', contentHash: '' };
    }
  }

  async function pdfOf(located) {
    const pdf = await located.inspect(PDF_NAME);
    if (pdf?.status !== 'ok') return null;
    const info = await fs.stat(pdf.path).catch(() => null);
    return info ? { name: PDF_NAME, modifiedAt: info.mtime.toISOString() } : null;
  }

  async function wire(located, snapshot) {
    return {
      name: LETTER_NAME,
      text: snapshot.text,
      contentHash: snapshot.contentHash,
      pdf: await pdfOf(located),
      editable: snapshot.editable,
    };
  }

  async function activeRun(id) {
    const rows = await select(jobDetailSql.activeRuns, id, { missingTable: true });
    return rows.find(row => BLOCKING_ACTIONS.includes(row.action)) ?? null;
  }

  async function read(id) {
    const located = await locate(id);
    if (!located) throw notFound();
    return wire(located, await snapshotOf(located));
  }

  async function save(id, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw invalid('body', 'Request body must be a JSON object.');
    for (const key of Object.keys(body))
      if (!['expectedHash', 'text'].includes(key)) throw invalid(key);
    if (typeof body.expectedHash !== 'string' || !HASH_PATTERN.test(body.expectedHash))
      throw invalid('expectedHash');
    const text = validateLetterText(body.text);
    return exclusive(async () => {
      const located = await locate(id);
      if (!located) throw notFound();
      const running = await activeRun(id);
      if (running)
        throw publicError(
          409,
          'RUN_ACTIVE',
          `A ${running.action} run is already active.`,
          undefined,
          { activeRunId: String(running.id) },
        );
      const current = await snapshotOf(located);
      if (!current.editable)
        throw publicError(
          409,
          'LETTER_NOT_EDITABLE',
          'This letter cannot be edited in the browser.',
        );
      if (current.contentHash !== body.expectedHash)
        throw publicError(
          409,
          'LETTER_CONFLICT',
          'The letter changed since it was loaded.',
          undefined,
          { text: current.text, contentHash: current.contentHash },
        );
      // Unchanged text (ignoring line-ending style) is a no-op: no write, no new mtime.
      if (normalizeLetterText(current.text) === text) return wire(located, current);
      const temporary = join(
        located.dir,
        `.${LETTER_NAME}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
      );
      try {
        await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
        // The bytes may have changed outside this server since the guard above; check again
        // immediately before the swap.
        const again = await snapshotOf(located);
        if (again.contentHash !== body.expectedHash)
          throw publicError(
            409,
            'LETTER_CONFLICT',
            'The letter changed since it was loaded.',
            undefined,
            { text: again.text, contentHash: again.contentHash },
          );
        await fs.rename(temporary, located.path);
      } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        if (error?.publicCode) throw error;
        throw publicError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
      }
      return wire(located, await snapshotOf(located));
    });
  }

  // The published cover-letter.pdf next to the letter, for the inline PDF route. The materials list
  // prefers cover-letter.md over the PDF for the letter key, so the PDF is served from here.
  async function pdf(id) {
    const located = await locate(id);
    if (!located) throw notFound();
    const file = await located.inspect(PDF_NAME);
    if (file?.status !== 'ok') throw notFound();
    const info = await fs.stat(file.path).catch(() => null);
    if (!info) throw notFound();
    return { name: PDF_NAME, size: info.size, stream: () => createReadStream(file.path) };
  }

  // For the run service: the absolute path, text and hash of the editable letter, or null.
  async function snapshot(id) {
    const located = await locate(id);
    if (!located) return null;
    const current = await snapshotOf(located);
    return { path: located.path, ...current };
  }

  return Object.freeze({ read, save, pdf, snapshot, exclusive });
}
