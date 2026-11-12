#!/usr/bin/env node
// import-llm-usage.mjs — backfill llm_calls (migration 011) from existing launcher logs.
//
// Usage:
//   node src/helpers/import-llm-usage.mjs            # dry run: counts by provider and function
//   node src/helpers/import-llm-usage.mjs --apply    # insert the rows (source = backfill)
//
// Reads logs/evaluation/**/*.stdout.log and logs/drafting/runs/**/*-usage.json. Idempotent: the
// log path is the log_ref and llm_calls.log_ref is unique, so a rerun inserts nothing new.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root as defaultRoot } from '../lib/root.mjs';
import { logRefOf, parseUsage, recordCall } from '../lib/_llm-usage.mjs';

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(entry.name)) out.push(full);
  }
  return out;
}

const read = path => readFileSync(path, 'utf8');
function json(path) {
  try {
    return JSON.parse(read(path));
  } catch {
    return null;
  }
}

// Evaluation file names are <phase>-<epoch ms>-<attempt>.stdout.log.
function evaluationFunction(name) {
  const phase = name.replace(/-\d{10,}-\d+\.stdout\.log$/, '');
  if (phase === 'research') return 'companyResearch';
  if (['gate', 'market', 'evaluation'].includes(phase)) return phase;
  if (phase === 'smoke' || phase.endsWith('-smoke')) return 'smoke';
  return null;
}

// Claude names the models it used; the one with the most output carries the call. Codex logs do
// not name the model, and neither does any run record, so it is recorded as unknown.
function claudeModel(text) {
  try {
    const entries = Object.entries(JSON.parse(text).modelUsage ?? {});
    entries.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0));
    return entries[0]?.[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function drafting_time(runName, path) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(runName);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : statSync(path).mtime.toISOString();
}

// Read-only plan: every row the logs can yield. knownJobs is a Set of existing job ids (a job id
// not in the set is stored as null rather than failing the foreign key).
export function planBackfill(root = defaultRoot, { knownJobs = null } = {}) {
  const rows = [];
  const skipped = [];
  for (const path of walk(join(root, 'logs', 'evaluation'), n => n.endsWith('.stdout.log'))) {
    const name = basename(path);
    const fn = evaluationFunction(name);
    if (!fn) {
      skipped.push(logRefOf(root, path));
      continue;
    }
    const text = read(path);
    const runRecord =
      json(join(dirname(path), '..', 'run.json')) ?? json(join(dirname(path), 'run.json'));
    let provider = ['claude', 'codex'].find(p => parseUsage(p, text));
    provider ??= runRecord?.provider === 'codex' ? 'codex' : 'claude';
    const parent = basename(dirname(path));
    const stamp = /-(\d{10,})-\d+\.stdout\.log$/.exec(name)?.[1];
    const usage = parseUsage(provider, text);
    rows.push({
      provider,
      model: usage?.model || (provider === 'claude' ? claudeModel(text) : 'unknown'),
      function: fn,
      jobId: /^\d+$/.test(parent) && (!knownJobs || knownJobs.has(parent)) ? parent : null,
      usage,
      calledAt: new Date(stamp ? Number(stamp) : statSync(path).mtimeMs).toISOString(),
      source: 'backfill',
      logRef: logRefOf(root, path),
    });
  }
  for (const path of walk(join(root, 'logs', 'drafting', 'runs'), n => n.endsWith('-usage.json'))) {
    const text = read(path);
    const run = basename(dirname(path));
    rows.push({
      provider: 'claude',
      model: claudeModel(text),
      function: /-letter-/.test(run) ? 'coverLetter' : 'cv',
      jobId: null,
      usage: parseUsage('claude', text),
      calledAt: drafting_time(run, path),
      source: 'backfill',
      logRef: logRefOf(root, path),
    });
  }
  return { rows, skipped };
}

export function summarize(rows) {
  const table = {};
  for (const r of rows) {
    const key = r.provider + ' / ' + r.function;
    table[key] ??= { calls: 0, usageMissing: 0 };
    table[key].calls++;
    if (!r.usage) table[key].usageMissing++;
  }
  return table;
}

export async function applyBackfill(rows, { query } = {}) {
  let inserted = 0;
  for (const row of rows) if (await recordCall(row, { query })) inserted++;
  return { inserted, alreadyPresent: rows.length - inserted };
}

// Rows already recorded without a job while the log path yields an existing job (the plan only
// carries job ids that exist). Never overwrites a job id that is set.
export function planRepairs(rows, existing) {
  return rows.filter(
    r => r.jobId != null && existing.has(r.logRef) && existing.get(r.logRef) == null,
  );
}

export async function applyRepairs(repairs, { query } = {}) {
  const run = query ?? (await import('../lib/_database.mjs')).query;
  let repaired = 0;
  for (const r of repairs)
    repaired += (
      await run(
        'UPDATE llm_calls SET job_id=$1::bigint WHERE log_ref=$2 AND job_id IS NULL RETURNING id',
        [r.jobId, r.logRef],
      )
    ).length;
  return repaired;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { query, close } = await import('../lib/_database.mjs');
  let existing = null;
  let note = null;
  let knownJobs = null;
  try {
    knownJobs = new Set((await query('SELECT id::text AS id FROM jobs')).map(r => r.id));
    existing = new Map(
      (
        await query(
          'SELECT log_ref, job_id::text AS job_id FROM llm_calls WHERE log_ref IS NOT NULL',
        )
      ).map(r => [r.log_ref, r.job_id]),
    );
  } catch (error) {
    if (apply) throw error;
    note =
      'Database not consulted (' +
      (error.code || error.message) +
      '); counts include rows that may already exist.';
  }
  try {
    const { rows, skipped } = planBackfill(defaultRoot, { knownJobs });
    const fresh = existing ? rows.filter(r => !existing.has(r.logRef)) : rows;
    const repairs = existing ? planRepairs(rows, existing) : [];
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      logFilesRead: rows.length + skipped.length,
      skippedUnrecognised: skipped.length,
      alreadyRecorded: rows.length - fresh.length,
      wouldInsert: fresh.length,
      wouldRepairJob: repairs.length,
      byProviderAndFunction: summarize(fresh),
      ...(note ? { note } : {}),
    };
    if (apply) {
      report.result = await applyBackfill(fresh);
      report.repaired = await applyRepairs(repairs);
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
