import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { retentionPlan } from './prune-logs.mjs';
const base = mkdtempSync(join(tmpdir(), 'career-retention-'));
try {
  mkdirSync(join(base, 'data/backups'), { recursive: true });
  for (let i = 0; i < 8; i++) {
    const f = join(base, 'data/backups', i + '.dump');
    writeFileSync(f, 'fixture');
    utimesSync(f, 100 + i, 100 + i);
  }
  writeFileSync(
    join(base, 'data/backups/0.dump.keep'),
    'Restore verified; retain this checkpoint.',
  );
  const actions = retentionPlan(base);
  assert.deepEqual(actions.map(a => a.path).sort(), ['data/backups/1.dump', 'data/backups/2.dump']);
  assert.ok(!actions.some(a => a.path.endsWith('.keep')));
  console.log('Retention tests passed: newest five plus explicitly protected restore checkpoints');
} finally {
  if (
    dirname(base) !== resolve(tmpdir()) ||
    !base.startsWith(join(resolve(tmpdir()), 'career-retention-'))
  )
    throw new Error('Unsafe test cleanup');
  rmSync(base, { recursive: true, force: true });
}
