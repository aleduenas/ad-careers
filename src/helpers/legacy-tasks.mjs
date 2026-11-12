#!/usr/bin/env node
// Read-only audit of the task records the retired Go TUI left under logs/dashboard/tasks/.
// It lists each record with its effective state, owner liveness and age, and says which records
// would block a cutover (running with a live owner). It writes, deletes and signals nothing.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import root from '../lib/root.mjs';
import { readProcessStartTime } from '../server/runs.mjs';
// The record parser and the liveness horizons are shared with the browser runs list.
import {
  ABANDONED_AFTER_MS,
  parseLegacyRecord,
  classifyLegacyRecord,
} from '../server/legacy-runs.mjs';

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const time = value => {
  const ms = Date.parse(value ?? '');
  return Number.isNaN(ms) ? null : ms;
};

// Classifies one record parsed by parseLegacyRecord (startedAt, pid, state). The effective state
// comes from the shared classifier so the rules cannot drift; only the owner and reason detail
// (for the report) is derived here. Returns { state, recorded, owner, reason, blocks }.
//   owner: 'live' | 'gone' | 'recycled' | 'unknown' | 'none' (terminal records have no owner check)
export async function classifyTask(
  record,
  { now = Date.now(), isAlive = defaultIsAlive, startTime = readProcessStartTime } = {},
) {
  const recorded = typeof record?.state === 'string' ? record.state : 'unknown';
  let seen = null;
  const { state } = await classifyLegacyRecord(record, {
    now,
    isAlive,
    processStartTime: async pid => (seen = await startTime(pid)),
  });
  if (recorded !== 'running')
    return { state, recorded, owner: 'none', reason: 'terminal record', blocks: false };
  const started = time(record.startedAt);
  const detail = (owner, reason) => ({
    state,
    recorded,
    owner,
    reason,
    blocks: state === 'running',
  });
  if (state === 'running')
    return seen
      ? detail('live', 'owner alive')
      : detail(
          'unknown',
          'pid is alive but its start time could not be checked; assumed to be the owner',
        );
  if (started !== null && now - started > ABANDONED_AFTER_MS)
    return detail('gone', 'running for more than 24 hours; treated as abandoned');
  if (!Number.isInteger(record.pid) || record.pid <= 0)
    return detail('gone', 'running record has no process id');
  if (!isAlive(record.pid)) return detail('gone', 'owner process is not running');
  return detail(
    'recycled',
    'pid is alive but started at a different time; it belongs to another process',
  );
}

function age(ms) {
  if (ms === null || ms < 0) return null;
  return Math.floor(ms / 1000);
}

// Reads every *.json record in dir (never writes). Unreadable files are reported, not skipped.
export async function auditTasks(dir, deps = {}) {
  const now = deps.now ?? Date.now();
  let names = [];
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const tasks = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = parseLegacyRecord(await readFile(join(dir, name), 'utf8'), name);
    } catch {
      parsed = { ok: false, reason: 'file could not be read' };
    }
    if (!parsed.ok) {
      tasks.push({
        file: name,
        state: 'unreadable',
        recorded: null,
        owner: 'unknown',
        reason: `record refused (${parsed.reason}); cannot tell whether it is running`,
        blocks: false,
        unreadable: true,
        ageSeconds: null,
      });
      continue;
    }
    const record = parsed.record;
    const verdict = await classifyTask(record, { ...deps, now });
    const reference = time(record.finishedAt) ?? time(record.updatedAt) ?? time(record.startedAt);
    tasks.push({
      file: name,
      action: record.action,
      number: record.number,
      pid: record.pid || null,
      phase: record.phase,
      startedAt: record.startedAt,
      browserRun: record.browserRun,
      ...verdict,
      ageSeconds: age(reference === null ? null : now - reference),
    });
  }
  tasks.sort((a, b) => (a.ageSeconds ?? Infinity) - (b.ageSeconds ?? Infinity));
  const counts = {};
  for (const t of tasks) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const blockers = tasks.filter(t => t.blocks);
  return {
    directory: dir,
    total: tasks.length,
    counts,
    blockers: blockers.length,
    unreadable: tasks.filter(t => t.unreadable).length,
    cutoverBlocked: blockers.length > 0,
    tasks,
  };
}

function duration(seconds) {
  if (seconds === null) return 'unknown';
  if (seconds < 90) return seconds + 's';
  if (seconds < 5400) return Math.round(seconds / 60) + 'm';
  if (seconds < 172800) return Math.round(seconds / 3600) + 'h';
  return Math.round(seconds / 86400) + 'd';
}

export function formatReport(report, { all = false } = {}) {
  const lines = [`Legacy TUI task records in ${report.directory}`];
  lines.push(
    `${report.total} record(s): ` +
      (Object.entries(report.counts)
        .map(([state, n]) => `${n} ${state}`)
        .join(', ') || 'none'),
  );
  const shown = report.tasks.filter(
    t => all || t.blocks || t.unreadable || t.state === 'interrupted',
  );
  for (const t of shown) {
    const what = [t.action, t.number === null ? null : '#' + t.number].filter(Boolean).join(' ');
    lines.push(
      `  ${t.blocks ? 'BLOCKS' : '      '} ${t.state.padEnd(11)} ${(what || t.file).padEnd(14)} ` +
        `age ${duration(t.ageSeconds).padEnd(7)} owner ${t.owner}${t.pid ? ' pid ' + t.pid : ''}: ${t.reason}`,
    );
  }
  if (!all && report.tasks.length > shown.length)
    lines.push(`  (${report.tasks.length - shown.length} finished record(s) hidden; use --all)`);
  lines.push(
    report.cutoverBlocked
      ? `CUTOVER BLOCKED: ${report.blockers} task(s) are running with a live owner. Let them finish; nothing was stopped.`
      : 'Cutover is not blocked by legacy TUI tasks.',
  );
  if (report.unreadable)
    lines.push(`Warning: ${report.unreadable} record(s) could not be read and were not judged.`);
  return lines.join('\n');
}

// Exit codes: 0 nothing blocks, 2 at least one running task with a live owner, 1 usage or I/O error.
export async function main(argv = process.argv.slice(2)) {
  const known = new Set(['--json', '--all', '--help']);
  const dirArg = argv.find(a => a.startsWith('--dir='));
  const unknown = argv.filter(a => !known.has(a) && !a.startsWith('--dir='));
  if (unknown.length || argv.includes('--help')) {
    console.error(
      'Usage: node src/helpers/legacy-tasks.mjs [--json] [--all] [--dir=PATH]\n' +
        'Read-only audit of logs/dashboard/tasks. Exit 0 = no blocker, 2 = blocked, 1 = error.',
    );
    return unknown.length ? 1 : 0;
  }
  const dir = dirArg ? resolve(dirArg.slice(6)) : resolve(root, 'logs', 'dashboard', 'tasks');
  if (dirArg) {
    try {
      if (!(await stat(dir)).isDirectory()) throw new Error('not a directory');
    } catch {
      console.error('Task directory not found: ' + dir);
      return 1;
    }
  }
  const report = await auditTasks(dir);
  console.log(
    argv.includes('--json')
      ? JSON.stringify(report, null, 2)
      : formatReport(report, {
          all: argv.includes('--all'),
        }),
  );
  return report.cutoverBlocked ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main().catch(error => {
    console.error(error.message);
    return 1;
  });
}
