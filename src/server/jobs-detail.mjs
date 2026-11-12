import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { query as databaseQuery } from '../lib/_database.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { readReportCompensation } from './jobs-compensation.mjs';
import { projectJob } from './jobs-read.mjs';
import { resolveJobMaterialDetail, slug } from './jobs-materials.mjs';
import { inspectSafeFile } from './jobs-paths.mjs';

const MAX_TEXT_BYTES = 1024 * 1024;
// The editable cover letter is capped at 256 KB (STAGE3_LETTER_CONTRACT.md).
export const LETTER_MAX_BYTES = 256 * 1024;
const MAX_PREP_ENTRIES = 2000;
const MAX_BIGINT = 9223372036854775807n;
const ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const MATERIAL_KEYS = ['cv', 'letter', 'brief'];
const KEYS = new Set([...MATERIAL_KEYS, 'prep']);

export const jobDetailSql = Object.freeze({
  job: `
  SELECT job.id::text AS id, job.revision::text AS revision, job.company, job.role,
         job.url, job.status, job.score::text AS score, job.source_date::text AS source_date,
         job.notes, job.report_path, job.salary_min::text AS salary_min,
         job.salary_max::text AS salary_max,
         (job.evaluation_error IS NOT NULL AND btrim(job.evaluation_error) <> '') AS evaluation_error,
         discovery.first_seen::text AS first_seen,
         (status_event.occurred_at AT TIME ZONE 'America/Toronto')::date::text AS status_date,
         discard_event.reason AS discard_reason
  FROM jobs AS job
  LEFT JOIN LATERAL (
    SELECT min(history.first_seen) AS first_seen
    FROM scan_history AS history WHERE history.url = job.url
  ) AS discovery ON true
  LEFT JOIN LATERAL (
    SELECT event.occurred_at
    FROM job_status_events AS event
    WHERE event.job_id = job.id AND event.new_status = job.status
      AND event.occurred_at IS NOT NULL
    ORDER BY event.id DESC LIMIT 1
  ) AS status_event ON true
  LEFT JOIN LATERAL (
    SELECT event.reason
    FROM job_status_events AS event
    WHERE event.job_id = job.id AND event.new_status = 'Discarded'
    ORDER BY event.id DESC LIMIT 1
  ) AS discard_event ON true
  WHERE job.id = $1::bigint`,
  jd: `SELECT content, content_hash, revision::text AS revision, synced_at
  FROM job_descriptions WHERE job_id = $1::bigint`,
  evaluations: `SELECT id::text AS id, score::text AS score, result_status, created_at
  FROM evaluations WHERE job_id = $1::bigint ORDER BY id DESC`,
  activeRuns: `SELECT id::text AS id, action FROM browser_runs
  WHERE job_id = $1::bigint AND state IN ('queued', 'running') ORDER BY created_at, id`,
  events: `SELECT id::text AS id, old_status, new_status, reason, actor, occurred_at, created_at
  FROM job_status_events WHERE job_id = $1::bigint ORDER BY id ASC`,
});

function publicError(statusCode, publicCode, message, fields) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  if (fields) error.fields = fields;
  return error;
}

export const ACTION_REASONS = Object.freeze({
  notEvaluable: 'Only Pending or Evaluated jobs can be evaluated.',
  noJd: 'No job description stored.',
  evaluateFirst: 'Evaluate the job first.',
  noLetter: 'No cover letter to publish.',
  active: action => `A ${action} run is already active.`,
});

// Prerequisites for the explicit actions (STAGE3_DISPATCH_CONTRACT.md). Only the job's status, its
// stored JD, whether an evaluation report exists and the active runs are consulted; a score is
// never part of any rule. `base` ignores active runs; `actions` adds them.
export function buildActions({
  status,
  hasJd,
  reportExists,
  letterReady = false,
  activeActions = [],
}) {
  const evaluateReason =
    status !== 'Pending' && status !== 'Evaluated'
      ? ACTION_REASONS.notEvaluable
      : !hasJd
        ? ACTION_REASONS.noJd
        : null;
  const draftReason = !hasJd
    ? ACTION_REASONS.noJd
    : !reportExists
      ? ACTION_REASONS.evaluateFirst
      : null;
  const base = {
    evaluate: evaluateReason,
    cv: draftReason,
    letter: draftReason,
    both: draftReason,
    publish: letterReady ? null : ACTION_REASONS.noLetter,
  };
  const active = new Set(activeActions);
  const actions = {};
  // Publishing renders the saved letter, so a running letter draft (which rewrites it) blocks it too.
  const blockers = { both: ['cv', 'letter'], publish: ['publish', 'letter'] };
  for (const name of ['evaluate', 'cv', 'letter', 'both', 'publish']) {
    const blocking = blockers[name] ?? [name];
    const running = blocking.find(action => active.has(action));
    const reason = base[name] ?? (running ? ACTION_REASONS.active(running) : null);
    actions[name] = { enabled: reason === null, reason };
  }
  const baseActions = Object.fromEntries(
    Object.entries(base).map(([name, reason]) => [name, { enabled: reason === null, reason }]),
  );
  return { actions, base: baseActions };
}

const invalid = field =>
  publicError(400, 'INVALID_REQUEST', 'Request parameter is invalid.', {
    [field]: 'Invalid value.',
  });
const unavailable = () => publicError(404, 'NOT_FOUND', 'Material unavailable');
const notFound = () => publicError(404, 'NOT_FOUND', 'Job or material not found.');

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

async function safeText(rootDir, relativePath, allowedRoots) {
  const inspected = await inspectSafeFile(rootDir, relativePath, allowedRoots);
  if (inspected?.status !== 'ok') return { state: inspected?.status ?? 'unsafe' };
  try {
    const info = await stat(inspected.path);
    if (info.size > MAX_TEXT_BYTES) return { state: 'invalid' };
    const bytes = await readFile(inspected.path);
    if (bytes.length > MAX_TEXT_BYTES) return { state: 'invalid' };
    return { state: 'ok', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { state: 'invalid' };
  }
}

async function readReport(row, rootDir) {
  if (!row.report_path) return { text: null, state: 'missing' };
  const result = await safeText(rootDir, String(row.report_path), ['data/evaluations', 'output']);
  return result.state === 'ok'
    ? { text: result.text, state: 'ok' }
    : { text: null, state: result.state };
}

// Mirrors the Go findInterviewPrepPath: exact company-role file, then the best company-plus-
// role-word match among data/interview-prep/*.md in name order.
export async function findInterviewPrep(row, rootDir) {
  const companySlug = slug(row.company);
  const roleSlug = slug(row.role);
  if (!companySlug) return null;
  const prepRelative = 'data/interview-prep';
  const root = await realpath(rootDir).catch(() => null);
  if (!root) return null;
  const describe = async name => {
    const inspected = await inspectSafeFile(rootDir, `${prepRelative}/${name}`, [prepRelative]);
    if (inspected?.status !== 'ok') return null;
    const info = await stat(inspected.path).catch(() => null);
    return info ? { name, size: info.size, path: inspected.path } : null;
  };
  const direct = await describe(`${companySlug}-${roleSlug}.md`);
  if (direct) return direct;
  let entries;
  try {
    entries = await readdir(resolve(root, prepRelative), { withFileTypes: true });
  } catch {
    return null;
  }
  if (entries.length > MAX_PREP_ENTRIES) return null;
  const noHyphen = companySlug.replaceAll('-', '');
  const roleWords = roleSlug.split('-');
  let best = null;
  let bestScore = 0;
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const lower = entry.name.toLowerCase();
    if (!entry.isFile() || !lower.endsWith('.md')) continue;
    if (lower === 'story-bank.md' || lower === 'readme.md') continue;
    const nameSlug = slug(lower.slice(0, -3));
    if (!nameSlug.replaceAll('-', '').includes(noHyphen)) continue;
    let score = 1;
    for (const word of roleWords) if (word.length > 2 && nameSlug.includes(word)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = entry.name;
    }
  }
  return best ? describe(best) : null;
}

export function createJobsDetail({
  query = databaseQuery,
  readCompensation = readReportCompensation,
  resolveMaterials = resolveJobMaterialDetail,
  findPrep = findInterviewPrep,
  rootDir = repositoryRoot,
} = {}) {
  for (const adapter of [query, readCompensation, resolveMaterials, findPrep])
    if (typeof adapter !== 'function')
      throw new TypeError('Job detail adapters must be functions.');

  async function select(sql, id) {
    let rows;
    try {
      rows = await query(sql, [id]);
    } catch (error) {
      if (error instanceof DatabaseUnavailableError || error instanceof SchemaNotReadyError)
        throw error;
      if (error?.code === '42P01' || error?.code === '42703') throw new SchemaNotReadyError();
      throw new DatabaseUnavailableError();
    }
    if (!Array.isArray(rows)) throw new DatabaseUnavailableError();
    return rows;
  }

  function checkId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw invalid('id');
    if (BigInt(id) > MAX_BIGINT) throw notFound();
  }

  async function loadJob(id) {
    const [row] = await select(jobDetailSql.job, id);
    if (!row) throw notFound();
    return row;
  }

  // Files the detail lists, each re-checked for containment and given real size and mtime.
  async function listMaterials(row) {
    const resolved = await resolveMaterials(row, rootDir);
    const items = [];
    const realRoot = await realpath(rootDir).catch(() => null);
    if (resolved?.dir && realRoot) {
      for (const key of MATERIAL_KEYS) {
        const file = resolved.files?.[key];
        if (!file) continue;
        const inspected = await inspectSafeFile(
          rootDir,
          relative(realRoot, resolve(resolved.dir, file.name)),
          ['output'],
        );
        if (inspected?.status !== 'ok') continue;
        const info = await stat(inspected.path).catch(() => null);
        if (!info) continue;
        items.push({
          key,
          name: file.name,
          kind: file.kind,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          path: inspected.path,
        });
      }
    }
    return {
      match: resolved?.match ?? 'none',
      ambiguous: Boolean(resolved?.ambiguous),
      items,
    };
  }

  // An editable cover-letter.md is in the matched folder (the exact name, within the size cap).
  const letterReadyOf = materials =>
    materials.items.some(
      item =>
        item.key === 'letter' && item.name === 'cover-letter.md' && item.size <= LETTER_MAX_BYTES,
    );

  // Active browser runs for the job. When browser_runs is unavailable (migration not applied, a
  // fixture transport) there are simply none; the dispatch itself is gated by the run service.
  async function activeRunRows(id) {
    try {
      const rows = await query(jobDetailSql.activeRuns, [id]);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  // The action prerequisites alone, for the run service's dispatch re-check. `base` ignores
  // active runs (the run service reports those as RUN_ACTIVE); `actions` is the full block.
  async function actionsFor(id) {
    checkId(id);
    const row = await loadJob(id);
    const [jdRows, report, materials, activeRows] = await Promise.all([
      select(jobDetailSql.jd, id),
      readReport(row, rootDir),
      listMaterials(row),
      activeRunRows(id),
    ]);
    return buildActions({
      status: row.status,
      hasJd: Boolean(jdRows[0]),
      reportExists: report.state === 'ok',
      letterReady: letterReadyOf(materials),
      activeActions: activeRows.map(item => item.action),
    });
  }

  async function detail(id) {
    checkId(id);
    const row = await loadJob(id);
    const [jdRows, evaluationRows, eventRows, activeRows] = await Promise.all([
      select(jobDetailSql.jd, id),
      select(jobDetailSql.evaluations, id),
      select(jobDetailSql.events, id),
      activeRunRows(id),
    ]);
    const [compensation, report, materials, prep] = await Promise.all([
      readCompensation(row, rootDir),
      readReport(row, rootDir),
      listMaterials(row),
      row.status === 'Interview' ? findPrep(row, rootDir) : null,
    ]);
    const flags = {
      cv: materials.items.some(item => item.key === 'cv'),
      letter: materials.items.some(item => item.key === 'letter' || item.key === 'brief'),
    };
    const job = {
      ...projectJob(row, new Map([[String(row.id), flags]]), compensation),
      notes: String(row.notes ?? ''),
      evaluationError: Boolean(row.evaluation_error),
    };
    const jd = jdRows[0]
      ? {
          text: String(jdRows[0].content),
          contentHash: String(jdRows[0].content_hash),
          revision: String(jdRows[0].revision),
          syncedAt: iso(jdRows[0].synced_at),
        }
      : null;
    const { actions } = buildActions({
      status: row.status,
      hasJd: Boolean(jdRows[0]),
      reportExists: report.state === 'ok',
      letterReady: letterReadyOf(materials),
      activeActions: activeRows.map(item => item.action),
    });
    return {
      job,
      jd,
      actions,
      evaluation: {
        report,
        history: evaluationRows.map(item => ({
          id: String(item.id),
          score: item.score == null ? null : Number(item.score),
          resultStatus: item.result_status,
          createdAt: iso(item.created_at),
        })),
      },
      history: eventRows.map(item => ({
        id: String(item.id),
        oldStatus: item.old_status ?? null,
        newStatus: item.new_status,
        reason: String(item.reason ?? ''),
        actor: String(item.actor ?? ''),
        occurredAt: iso(item.occurred_at),
        createdAt: iso(item.created_at),
      })),
      materials: {
        match: materials.match,
        ambiguous: materials.ambiguous,
        items: materials.items.map(({ path: _path, ...item }) => item),
      },
      interviewPrep: prep ? { name: prep.name, size: prep.size } : null,
    };
  }

  // One listed file, re-resolved on every request. Returns text for text kinds and a stream
  // factory for PDF; the caller never supplies a path.
  async function material(id, key) {
    checkId(id);
    if (typeof key !== 'string' || !KEYS.has(key)) throw invalid('key');
    const row = await loadJob(id);
    let file;
    if (key === 'prep') {
      if (row.status !== 'Interview') throw notFound();
      const prep = await findPrep(row, rootDir);
      if (prep) file = { name: prep.name, kind: 'md', size: prep.size, path: prep.path };
    } else {
      file = (await listMaterials(row)).items.find(item => item.key === key);
    }
    if (!file) throw notFound();
    if (file.kind === 'pdf')
      return {
        kind: 'pdf',
        name: file.name,
        size: file.size,
        stream: () => createReadStream(file.path),
      };
    if (file.size > MAX_TEXT_BYTES) throw unavailable();
    try {
      const bytes = await readFile(file.path);
      if (bytes.length > MAX_TEXT_BYTES) throw unavailable();
      return {
        kind: 'text',
        name: file.name,
        size: bytes.length,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      };
    } catch (error) {
      if (error?.publicCode) throw error;
      throw unavailable();
    }
  }

  return Object.freeze({ detail, material, actionsFor });
}
