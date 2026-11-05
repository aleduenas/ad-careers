#!/usr/bin/env node
// prune-logs.mjs — apply the log/backup retention policy (documentation/guides/layout.md, Session 04).
//
// Usage:
//   node src/helpers/prune-logs.mjs            # dry run: list what would change
//   node src/helpers/prune-logs.mjs --apply    # perform the changes
//
// Policy:
//   logs/tests/**                     delete files older than 7 days
//   logs/dashboard/**                 delete files older than 30 days
//   logs/evaluation/legacy-output-evaluation/, logs/drafting/legacy-output-drafting/
//                                     move to data/archive/legacy-logs/ (old run formats)
//   data/backups/*.dump               keep the newest 5
// Never touched: logs/evaluation/<run>/ (resumable), logs/drafting/runs, logs/publishing,
// logs/token-usage, lock files, data/archive/.
import {
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../lib/root.mjs';

export function retentionPlan(root, now = Date.now()) {
  const DAY = 86400000;
  const actions = [];

  function olderThan(dir, days) {
    const base = join(root, dir);
    if (!existsSync(base)) return;
    for (const e of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      const full = join(e.parentPath ?? e.path, e.name);
      if (now - statSync(full).mtimeMs > days * DAY)
        actions.push({ op: 'delete', path: relative(root, full) });
    }
  }
  olderThan('logs/tests', 7);
  olderThan('logs/dashboard', 30);

  for (const legacy of [
    'logs/evaluation/legacy-output-evaluation',
    'logs/drafting/legacy-output-drafting',
  ]) {
    if (existsSync(join(root, legacy)))
      actions.push({
        op: 'move',
        path: legacy,
        to: 'data/archive/legacy-logs/' + legacy.split('/').pop(),
      });
  }

  const backups = join(root, 'data/backups');
  if (existsSync(backups)) {
    const dumps = readdirSync(backups)
      .filter(f => f.endsWith('.dump'))
      .map(f => ({ f, t: statSync(join(backups, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of dumps.slice(5))
      if (!existsSync(join(backups, f + '.keep')))
        actions.push({ op: 'delete', path: 'data/backups/' + f });
  }
  return actions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const APPLY = process.argv.includes('--apply');
  const actions = retentionPlan(root);
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    delete: actions.filter(a => a.op === 'delete').length,
    move: actions.filter(a => a.op === 'move').length,
  };
  if (!APPLY) {
    console.log(JSON.stringify({ ...summary, actions }, null, 2));
    process.exit(0);
  }
  for (const a of actions) {
    if (a.op === 'delete') unlinkSync(join(root, a.path));
    else {
      mkdirSync(join(root, a.to, '..'), { recursive: true });
      if (existsSync(join(root, a.to))) throw new Error('Refusing to overwrite ' + a.to);
      renameSync(join(root, a.path), join(root, a.to));
    }
  }
  // remove directories emptied by deletions under the pruned trees
  for (const dir of ['logs/tests', 'logs/dashboard']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const d = join(base, e.name);
      if (e.isDirectory() && readdirSync(d).length === 0) rmSync(d, { recursive: true });
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}
