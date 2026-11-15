import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { root as repositoryRoot } from '../lib/root.mjs';

// Read-only view of the task records the retired Go TUI left under logs/dashboard/tasks/
// (listed as source 'legacy'). Record format: see
// src/lib/_task-status.mjs. Nothing here writes,
// deletes or signals anything, and a bad record is skipped and counted, never thrown.
//
// The pure parser and classifier are exported so the 4.2 audit helper (src/helpers/legacy-tasks.mjs)
// shares them. Liveness adapters are injected so this module imports nothing from runs.mjs.

export const LEGACY_ACTIONS = Object.freeze([
  'evaluate',
  'cv',
  'letter',
  'both',
  'scan',
  'intake',
  'publish',
]);
const STATES = new Set(['running', 'completed', 'failed', 'interrupted']);
// A record still running after a day is abandoned (also guards against a recycled pid).
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
// The TUI stamps started_at (whole seconds) just before spawning the worker.
export const START_BEFORE_MS = 5000;
export const START_AFTER_MS = 30000;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 5000;
const LOG_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Browser-launched runs write their own record named <action>-<job>-<date>-<time>-<8 hex>; the TUI
// names end in a long decimal number.
const BROWSER_STEM = /-[0-9a-f]{8}$/;

// A deterministic RFC 4122 style id from the record file name, so the wire id is stable.
export function legacyRunId(stem) {
  const bytes = createHash('sha1').update(`career-ops-legacy-run:${stem}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const stamp = value => {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};
const clean = (value, max) =>
  // eslint-disable-next-line no-control-regex
  [...String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')].slice(0, max).join('');

// Parses and validates one record's text. Returns { ok: true, record } or { ok: false, reason }.
// `name` is the file name, used for the stem and the browser-duplicate rule.
export function parseLegacyRecord(text, name) {
  const stem = String(name).replace(/\.json$/i, '');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'not an object' };
  if (typeof value.action !== 'string' || !LEGACY_ACTIONS.includes(value.action))
    return { ok: false, reason: 'unknown action' };
  if (typeof value.state !== 'string' || !STATES.has(value.state))
    return { ok: false, reason: 'unknown state' };
  const optionalInt = (field, min) => {
    const item = value[field];
    if (item === undefined || item === null) return null;
    return Number.isSafeInteger(item) && item >= min ? item : undefined;
  };
  const number = optionalInt('number', 0);
  const pid = optionalInt('pid', 0);
  const attempt = optionalInt('attempt', 1);
  const exitCode = optionalInt('exit_code', -2147483648);
  if (number === undefined || pid === undefined || attempt === undefined || exitCode === undefined)
    return { ok: false, reason: 'bad number' };
  for (const field of ['started_at', 'updated_at', 'finished_at'])
    if (value[field] !== undefined && value[field] !== null && stamp(value[field]) === null)
      return { ok: false, reason: 'bad timestamp' };
  if (typeof value.log !== 'string' && value.log !== undefined && value.log !== null)
    return { ok: false, reason: 'bad log' };
  return {
    ok: true,
    record: {
      stem,
      action: value.action,
      number: number ?? 0,
      pid: pid ?? 0,
      log: typeof value.log === 'string' ? value.log : '',
      state: value.state,
      phase: typeof value.phase === 'string' ? clean(value.phase, 80) : '',
      attempt: attempt ?? 1,
      startedAt: stamp(value.started_at),
      updatedAt: stamp(value.updated_at),
      finishedAt: stamp(value.finished_at),
      exitCode,
      // Present on records written for browser runs after 2026-11-10; older ones are told apart by
      // their file name.
      browserRun:
        (typeof value.run_id === 'string' && value.run_id !== '') || BROWSER_STEM.test(stem),
    },
  };
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

// Effective state of a parsed record: a recorded `running` whose owner is gone, recycled or older
// than 24 h reads as `interrupted`. Returns { state, errorCode }. Never writes back.
export async function classifyLegacyRecord(
  record,
  { now = Date.now(), isAlive = defaultIsAlive, processStartTime = async () => null } = {},
) {
  if (record.state === 'completed') return { state: 'completed', errorCode: null };
  if (record.state === 'failed') return { state: 'failed', errorCode: 'EXIT_NONZERO' };
  if (record.state === 'interrupted') return { state: 'interrupted', errorCode: 'PROCESS_GONE' };
  const started = record.startedAt ? Date.parse(record.startedAt) : null;
  if (started !== null && now - started > ABANDONED_AFTER_MS)
    return { state: 'interrupted', errorCode: 'STALE_24H' };
  const gone = { state: 'interrupted', errorCode: 'PROCESS_GONE' };
  if (!Number.isInteger(record.pid) || record.pid <= 0 || !isAlive(record.pid)) return gone;
  let actual = null;
  try {
    actual = await processStartTime(record.pid);
  } catch {
    actual = null;
  }
  const actualMs = actual ? new Date(actual).getTime() : null;
  if (actualMs !== null && started !== null) {
    const delta = actualMs - started;
    if (delta < -START_BEFORE_MS || delta > START_AFTER_MS) return gone;
  }
  return { state: 'running', errorCode: null };
}

// Wire run (the same shape as toWireRun, source 'legacy'). `fallbackTime` is the file mtime.
export function legacyWireRun(record, { state, errorCode }, fallbackTime) {
  const fallback = new Date(fallbackTime).toISOString();
  const terminal = state !== 'running';
  return {
    id: legacyRunId(record.stem),
    requestKey: `legacy:${record.stem}`.slice(0, 200),
    groupId: null,
    action: record.action,
    jobId: record.number > 0 ? String(record.number) : null,
    state,
    phase: record.phase,
    attempt: record.attempt,
    exitCode: record.exitCode,
    errorCode,
    createdAt: record.startedAt ?? record.updatedAt ?? record.finishedAt ?? fallback,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt ?? record.finishedAt ?? record.startedAt ?? fallback,
    finishedAt: terminal ? (record.finishedAt ?? record.updatedAt ?? fallback) : null,
    selection: {},
    source: 'legacy',
  };
}

export function createLegacyRuns({
  rootDir = repositoryRoot,
  isAlive = defaultIsAlive,
  processStartTime = async () => null,
  now = () => new Date(),
} = {}) {
  const recordDir = join(rootDir, 'logs', 'dashboard', 'tasks');
  // Parsed files by name, valid while size and mtime are unchanged. Liveness is never cached.
  const cache = new Map();
  let skipped = 0;

  async function load() {
    let names;
    try {
      names = (await readdir(recordDir)).filter(name => name.toLowerCase().endsWith('.json'));
    } catch {
      return [];
    }
    skipped = 0;
    if (names.length > MAX_RECORDS) {
      skipped += names.length - MAX_RECORDS;
      names = names.slice(0, MAX_RECORDS);
    }
    const seen = new Set(names);
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    const loaded = [];
    for (const name of names) {
      const path = join(recordDir, name);
      let info;
      try {
        info = await lstat(path);
      } catch {
        continue;
      }
      if (!info.isFile() || info.size > MAX_RECORD_BYTES) {
        skipped += 1;
        continue;
      }
      const token = `${info.size}:${info.mtimeMs}`;
      let entry = cache.get(name);
      if (!entry || entry.token !== token) {
        let parsed;
        try {
          parsed = parseLegacyRecord(await readFile(path, 'utf8'), name);
        } catch {
          parsed = { ok: false, reason: 'unreadable' };
        }
        entry = { token, parsed, mtime: info.mtime };
        cache.set(name, entry);
      }
      if (!entry.parsed.ok) {
        skipped += 1;
        continue;
      }
      // A browser run keeps its own record for the TUI; its row comes from browser_runs.
      if (entry.parsed.record.browserRun) continue;
      loaded.push({ record: entry.parsed.record, mtime: entry.mtime });
    }
    return loaded;
  }

  async function project() {
    const at = now().getTime();
    const rows = [];
    for (const { record, mtime } of await load()) {
      const effective = await classifyLegacyRecord(record, {
        now: at,
        isAlive,
        processStartTime,
      });
      rows.push({
        run: legacyWireRun(record, effective, mtime),
        // Only the file name is kept: the log is always read from logs/dashboard/<name>.
        logRef: LOG_REF_PATTERN.test(basename(record.log.replaceAll('\\', '/')))
          ? basename(record.log.replaceAll('\\', '/'))
          : null,
      });
    }
    const when = row => Date.parse(row.run.finishedAt ?? row.run.updatedAt) || 0;
    return rows.sort((a, b) => when(b) - when(a));
  }

  // Active legacy rows first, then the newest `limit` terminal rows (default 12), optionally for
  // one job. Records that cannot be parsed are counted in stats().skipped, never thrown.
  async function list({ jobId, limit = 12 } = {}) {
    const rows = (await project())
      .map(row => row.run)
      .filter(run => jobId === undefined || run.jobId === jobId);
    const active = rows.filter(run => run.state === 'running');
    const terminal = rows.filter(run => run.state !== 'running').slice(0, limit);
    return [...active, ...terminal];
  }

  // One legacy run by its wire id, with the log file name when the record names one.
  async function find(id) {
    return (await project()).find(row => row.run.id === id) ?? null;
  }

  return Object.freeze({ list, find, stats: () => ({ skipped }) });
}
