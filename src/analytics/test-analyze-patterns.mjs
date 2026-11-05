import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadReportForJob } from './analyze-patterns.mjs';
const base = mkdtempSync(join(tmpdir(), 'career-analytics-'));
try {
  mkdirSync(join(base, 'data/evaluations'), { recursive: true });
  writeFileSync(
    join(base, 'data/evaluations/1.md'),
    '| Archetype | Security Engineer |\n| Location | Remote, Canada |\n',
  );
  const result = loadReportForJob({ report_path: 'data/evaluations/1.md' }, base);
  assert.equal(result.archetype, 'Security Engineer');
  assert.equal(result.remote, 'Remote, Canada');
  assert.equal(loadReportForJob({}, base), null);
  console.log('Analytics regression passed: root-relative database report paths resolve correctly');
} finally {
  if (
    dirname(base) !== resolve(tmpdir()) ||
    !base.startsWith(join(resolve(tmpdir()), 'career-analytics-'))
  )
    throw new Error('Unsafe cleanup');
  rmSync(base, { recursive: true, force: true });
}
