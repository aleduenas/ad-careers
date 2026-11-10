import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { query as databaseQuery } from '../lib/_database.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { resolveJobMaterials } from './jobs-materials.mjs';
import { readReportCompensation } from './jobs-compensation.mjs';

const STATUSES = [
  'Pending',
  'Evaluated',
  'Applied',
  'Interview',
  'Offer',
  'Rejected',
  'Discarded',
  'Ghosted',
];
const FILTERS = new Set([
  'all',
  'pending',
  'evaluated',
  'applied',
  'interview',
  'ghosted',
  'top',
  'rejected',
  'discarded',
  'offer',
]);
const SORTS = new Set(['score', 'statusDate', 'addedDate', 'company']);
const BASE_SQL = `
  SELECT job.id::text AS id, job.revision::text AS revision, job.company, job.role,
         job.url, job.status, job.score::text AS score, job.source_date::text AS source_date,
         job.notes, job.report_path, job.salary_min::text AS salary_min,
         job.salary_max::text AS salary_max,
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
  ORDER BY job.id`;

function requestError(field, message = 'Query parameter is invalid.') {
  const error = new Error(message);
  error.statusCode = 400;
  error.publicCode = 'INVALID_REQUEST';
  error.fields = { [field]: 'Invalid value.' };
  return error;
}

export function normalizeJobsQuery(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw requestError('query');
  const allowed = new Set(['q', 'filter', 'sort', 'direction', 'grouped', 'limit', 'cursor']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw requestError(key);
  const q = raw.q ?? '';
  if (typeof q !== 'string' || [...q].length > 200) throw requestError('q');
  const filter = raw.filter ?? 'all';
  if (typeof filter !== 'string' || !FILTERS.has(filter)) throw requestError('filter');
  const sort = raw.sort ?? 'score';
  if (typeof sort !== 'string' || !SORTS.has(sort)) throw requestError('sort');
  const direction = raw.direction ?? (sort === 'company' ? 'asc' : 'desc');
  if (direction !== 'asc' && direction !== 'desc') throw requestError('direction');
  let grouped = raw.grouped ?? 'true';
  if (grouped === true || grouped === false) grouped = String(grouped);
  if (grouped !== 'true' && grouped !== 'false') throw requestError('grouped');
  let limit = raw.limit ?? '50';
  if (typeof limit === 'number') limit = String(limit);
  if (typeof limit !== 'string' || !/^(?:[1-9][0-9]*)$/.test(limit)) throw requestError('limit');
  limit = Number(limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw requestError('limit');
  const cursor = raw.cursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048 || !cursor))
    throw requestError('cursor');
  return {
    query: { q, filter, sort, direction, grouped: grouped === 'true', limit },
    cursor,
  };
}

function cursorError() {
  return requestError('cursor', 'The page cursor is invalid or out of date. Refresh the list.');
}

function queryFingerprint(query) {
  return createHash('sha256').update(JSON.stringify(query)).digest('base64url');
}

function signOffset(offset, query, key) {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, q: queryFingerprint(query), o: offset }),
  ).toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyOffset(token, query, key) {
  try {
    if (token.length > 2048) throw new Error();
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) throw new Error();
    const expected = createHmac('sha256', key).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      decoded.v !== 1 ||
      decoded.q !== queryFingerprint(query) ||
      !Number.isSafeInteger(decoded.o) ||
      decoded.o < 0
    )
      throw new Error();
    return decoded.o;
  } catch {
    throw cursorError();
  }
}

function normalizedText(value) {
  return String(value ?? '').toLocaleLowerCase('en-CA');
}

function matches(row, q) {
  if (!q) return true;
  const needle = normalizedText(q);
  return [row.id, `#${row.id}`, row.company, row.role, row.notes, row.discard_reason].some(value =>
    normalizedText(value).includes(needle),
  );
}

function addedDate(row) {
  return row.source_date || row.first_seen || null;
}

function dateSortValue(row, kind) {
  if (kind === 'addedDate') return addedDate(row);
  return row.status === 'Pending' || !row.status_date ? addedDate(row) : row.status_date;
}

function compareNullableNewest(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a === b ? 0 : a > b ? -1 : 1;
}

function compareDateDirection(a, b, direction) {
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    return a == null ? 1 : -1;
  }
  const ascending = a === b ? 0 : a < b ? -1 : 1;
  return direction === 'desc' ? -ascending : ascending;
}

function compareNumberDirection(a, b, direction) {
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    return a == null ? 1 : -1;
  }
  const ascending = a === b ? 0 : a < b ? -1 : 1;
  return direction === 'desc' ? -ascending : ascending;
}

function statusPriority(status) {
  const order = [
    'Interview',
    'Offer',
    'Applied',
    'Evaluated',
    'Ghosted',
    'Rejected',
    'Discarded',
    'Pending',
  ];
  return order.indexOf(status);
}

function compareIds(a, b) {
  const aa = BigInt(a.id);
  const bb = BigInt(b.id);
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

function compareRows(a, b, query, materialMap) {
  if (query.grouped) {
    const group = statusPriority(a.status) - statusPriority(b.status);
    if (group) return group;
  }
  if (query.filter === 'evaluated') {
    const am = materialMap.get(a.id) || { cv: false, letter: false };
    const bm = materialMap.get(b.id) || { cv: false, letter: false };
    const ah = am.cv || am.letter;
    const bh = bm.cv || bm.letter;
    if (ah !== bh) return ah ? -1 : 1;
  }
  let primary = 0;
  let secondary = 0;
  if (query.sort === 'score') {
    const as = a.score == null ? null : Number(a.score);
    const bs = b.score == null ? null : Number(b.score);
    primary = compareNumberDirection(as, bs, query.direction);
  } else if (query.sort === 'company') {
    const ac = normalizedText(a.company);
    const bc = normalizedText(b.company);
    primary = ac === bc ? 0 : ac < bc ? -1 : 1;
    if (query.direction === 'desc') primary *= -1;
  } else {
    primary = compareDateDirection(
      dateSortValue(a, query.sort),
      dateSortValue(b, query.sort),
      query.direction,
    );
    const other = query.sort === 'statusDate' ? 'addedDate' : 'statusDate';
    secondary = compareNullableNewest(dateSortValue(a, other), dateSortValue(b, other));
  }
  return primary || secondary || compareIds(a, b);
}

function selected(row, filter) {
  if (filter === 'all') return row.status !== 'Pending';
  if (filter === 'pending') return row.status === 'Pending';
  if (filter === 'top')
    return (
      Number(row.score) >= 4 &&
      row.status !== 'Pending' &&
      !['Ghosted', 'Discarded'].includes(row.status)
    );
  return row.status.toLowerCase() === filter;
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function salaryPair(row) {
  const min = row.salary_min;
  const max = row.salary_max;
  if (min == null && max == null) return null;
  return {
    min: min == null ? null : String(min),
    max: max == null ? null : String(max),
    source: 'manual',
  };
}

function money(value) {
  const [whole = '0', fraction = ''] = String(value).split('.');
  const rounded = BigInt(whole) + (fraction[0] >= '5' ? 1n : 0n);
  return `$${rounded.toLocaleString('en-CA')}`;
}

async function mapLimit(items, limit, callback) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        output[index] = await callback(items[index], index);
      }
    }),
  );
  return output;
}

function projectJob(row, materialMap, compensation) {
  const salary = salaryPair(row);
  const manualValid =
    salary &&
    salary.min !== null &&
    salary.max !== null &&
    Number.isFinite(Number(salary.min)) &&
    Number.isFinite(Number(salary.max)) &&
    Number(salary.min) >= 0 &&
    Number(salary.max) >= Number(salary.min);
  let comp;
  if (row.status === 'Pending') comp = { text: null, state: 'notEvaluated' };
  else if (salary && (salary.min === null || salary.max === null || !manualValid)) {
    comp =
      !manualValid && salary.min !== null && salary.max !== null
        ? { text: null, state: 'invalid' }
        : compensation;
  } else if (manualValid) {
    comp = { text: `${money(salary.min)} - ${money(salary.max)} (edited)`, state: 'manual' };
  } else comp = compensation;
  return {
    id: String(row.id),
    revision: String(row.revision),
    company: row.company,
    role: row.role,
    url: safeUrl(row.url),
    status: row.status,
    score: row.score == null ? null : Number(row.score),
    addedDate: addedDate(row),
    statusDate: row.status_date || null,
    discardReason: row.discard_reason || null,
    salary,
    compensation: comp,
    materials: materialMap.get(String(row.id)) || { cv: false, letter: false },
  };
}

function safeNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safePct(part, whole) {
  return whole === 0 ? 0 : (part / whole) * 100;
}

function overviewFromRows(rows) {
  const statusCounts = Object.fromEntries(STATUSES.filter(s => s !== 'Pending').map(s => [s, 0]));
  const nonPending = rows.filter(row => row.status !== 'Pending');
  let scoreSum = 0;
  let scored = 0;
  let topScore = null;
  let actionable = 0;
  for (const row of nonPending) {
    statusCounts[row.status]++;
    const score = safeNumber(row.score);
    if (score !== null && score > 0) {
      scoreSum += score;
      scored++;
      topScore = topScore === null ? score : Math.max(topScore, score);
    }
    if (!['Ghosted', 'Rejected', 'Discarded'].includes(row.status)) actionable++;
  }
  const applied =
    statusCounts.Applied +
    statusCounts.Interview +
    statusCounts.Offer +
    statusCounts.Rejected +
    statusCounts.Ghosted;
  const responded = statusCounts.Interview + statusCounts.Offer + statusCounts.Rejected;
  const rejectedWithInterview = rows.filter(
    row => row.status === 'Rejected' && normalizedText(row.notes).includes('interview'),
  ).length;
  const interview = statusCounts.Interview + statusCounts.Offer + rejectedWithInterview;
  const offers = statusCounts.Offer;
  const funnel = [
    { label: 'Evaluated', count: nonPending.length, percent: 100 },
    { label: 'Applied', count: applied, percent: safePct(applied, nonPending.length) },
    { label: 'Responded', count: responded, percent: safePct(responded, applied) },
    { label: 'Interview', count: interview, percent: safePct(interview, applied) },
    { label: 'Offer', count: offers, percent: safePct(offers, applied) },
  ];
  const buckets = [0, 0, 0, 0, 0];
  for (const row of rows) {
    const score = safeNumber(row.score);
    if (score === null || score <= 0) continue;
    if (score >= 4.5) buckets[0]++;
    else if (score >= 4) buckets[1]++;
    else if (score >= 3.5) buckets[2]++;
    else if (score >= 3) buckets[3]++;
    else buckets[4]++;
  }
  const labels = ['4.5-5.0', '4.0-4.4', '3.5-3.9', '3.0-3.4', '  <3.0'];
  const weeks = new Map();
  for (const row of rows) {
    const date = addedDate(row);
    if (!date) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.valueOf())) continue;
    const thursday = new Date(parsed);
    thursday.setUTCDate(parsed.getUTCDate() + 4 - (parsed.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const key = `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    weeks.set(key, (weeks.get(key) || 0) + 1);
  }
  const weeklyActivity = [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, count]) => ({ week, count }));
  return {
    label: 'inferredFromCurrentState',
    metrics: {
      total: nonPending.length,
      actionable,
      byStatus: statusCounts,
      avgScore: scored ? scoreSum / scored : null,
      topScore,
    },
    progress: {
      funnel,
      responseRate: safePct(responded, applied),
      interviewRate: safePct(interview, applied),
      offerRate: safePct(offers, applied),
      scoreBuckets: buckets.map((count, i) => ({ label: labels[i], count })),
      weeklyActivity,
    },
  };
}

export function createJobsReader({
  query = databaseQuery,
  resolveMaterials = resolveJobMaterials,
  readCompensation = readReportCompensation,
  cursorKey = randomBytes(32),
  rootDir = repositoryRoot,
} = {}) {
  if (
    typeof query !== 'function' ||
    typeof resolveMaterials !== 'function' ||
    typeof readCompensation !== 'function'
  )
    throw new TypeError('Jobs reader adapters must be functions.');
  const key = Buffer.isBuffer(cursorKey) ? cursorKey : Buffer.from(cursorKey);
  if (key.length < 32) throw new TypeError('Cursor signing key must contain at least 32 bytes.');

  async function loadRows() {
    let rows;
    try {
      rows = await query(BASE_SQL);
    } catch (error) {
      if (error instanceof DatabaseUnavailableError || error instanceof SchemaNotReadyError)
        throw error;
      if (error?.code === '42P01' || error?.code === '42703') throw new SchemaNotReadyError();
      throw new DatabaseUnavailableError();
    }
    if (!Array.isArray(rows)) throw new DatabaseUnavailableError();
    return rows;
  }

  async function list(rawQuery = {}) {
    const { query: normalized, cursor } = normalizeJobsQuery(rawQuery);
    const offset = cursor === undefined ? 0 : verifyOffset(cursor, normalized, key);
    const rows = await loadRows();
    const filtered = rows.filter(
      row => selected(row, normalized.filter) && matches(row, normalized.q),
    );
    const materials = await resolveMaterials(filtered, rootDir);
    const map = materials instanceof Map ? materials : new Map(Object.entries(materials || {}));
    for (const [id, flags] of map)
      map.set(String(id), { cv: Boolean(flags?.cv), letter: Boolean(flags?.letter) });
    filtered.sort((a, b) => compareRows(a, b, normalized, map));
    if (offset > 0 && offset >= filtered.length) throw cursorError();
    const page = filtered.slice(offset, offset + normalized.limit);
    const items = await mapLimit(page, 8, async row => {
      const compensation = await readCompensation(row, rootDir);
      return projectJob(row, map, compensation);
    });
    const next =
      offset + normalized.limit < filtered.length
        ? signOffset(offset + normalized.limit, normalized, key)
        : null;
    const previous =
      offset > 0 ? signOffset(Math.max(0, offset - normalized.limit), normalized, key) : null;
    return {
      items,
      totalCount: filtered.length,
      nextCursor: next,
      previousCursor: previous,
      query: normalized,
    };
  }

  async function overview() {
    return overviewFromRows(await loadRows());
  }

  return Object.freeze({ list, overview });
}

export const jobsReadSql = BASE_SQL;
