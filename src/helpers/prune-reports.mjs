#!/usr/bin/env node
// prune-reports.mjs — safely retire report files that nothing references.
//
// Moves the named files from data/evaluations/ into data/evaluations/.trash/ (created on demand,
// gitignored via data/evaluations/). REFUSES to prune any file that is still referenced
// by PostgreSQL jobs — the tracker link is the liveness signal.
//
// Usage:
//   node src/helpers/prune-reports.mjs <filename> [<filename> ...]
//   node src/helpers/prune-reports.mjs --list     # show what's already in .trash

import { readFileSync, renameSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { root as ROOT, query } from '../lib/_database.mjs';

const REPORTS_DIR = join(ROOT, 'data', 'evaluations');
const TRASH_DIR = join(REPORTS_DIR, '.trash');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node src/helpers/prune-reports.mjs <filename> [...] | --list');
  process.exit(1);
}
if (args[0] === '--list') {
  const items = existsSync(TRASH_DIR) ? readdirSync(TRASH_DIR) : [];
  console.log(items.length ? items.join('\n') : '(trash is empty)');
  process.exit(0);
}

const apps = (await query('SELECT report_path FROM jobs UNION SELECT report_path FROM evaluations'))
  .map(r => r.report_path || '')
  .join('\n');
const errors = [];
for (const f of args) {
  if (!existsSync(join(REPORTS_DIR, f))) errors.push(`not found in data/evaluations/: ${f}`);
  else if (apps.includes(f)) errors.push(`still referenced by PostgreSQL jobs — refusing: ${f}`);
}
if (errors.length) {
  for (const e of errors) console.error(`✖ ${e}`);
  console.error('Nothing was moved.');
  process.exit(1);
}

mkdirSync(TRASH_DIR, { recursive: true });
for (const f of args) {
  renameSync(join(REPORTS_DIR, f), join(TRASH_DIR, f));
  console.log(`pruned: ${f}`);
}
console.log(`${args.length} file(s) moved to data/evaluations/.trash/`);
