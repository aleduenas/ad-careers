import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from './import-legacy.mjs';
const dir = mkdtempSync(join(tmpdir(), 'career-import-test-'));
const put = (path, text) => {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
};
try {
  put(
    'data/pipeline.md',
    '## Pending\n- 1 | https://example.test/1 | Acme | Engineer\n- 2 | https://example.test/2 | Beta | Analyst\n',
  );
  put(
    'data/applications.md',
    '## Applied\n| 001 | 2026-09-01 | Acme | Engineer | 4.0/5 | [001](../reports/001.md) | Applied 2026-09-02; A note |\n',
  );
  put('reports/001.md', '**URL:** https://example.test/1\n');
  put('data/id-counter', '9');
  let result = audit(dir);
  assert.deepEqual(result.errors, []);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].status, 'Applied');
  assert.equal(result.jobs[0].applied_at, '2026-09-02');
  assert.equal(result.jobs[1].score, null);
  assert.equal(result.lastAllocated, 9);
  assert.equal(audit(dir).fingerprint, result.fingerprint);
  put('reports/001.md', '');
  result = audit(dir);
  assert.ok(result.warnings.some(w => w.includes('Missing report')));
  assert.equal(result.jobs[0].report_path, 'reports/001.md');
  put('reports/001.md', '**URL:** https://example.test/1\n');
  put(
    'data/pipeline.md',
    '## Pending\n- 1 | https://example.test/1 | Acme | Engineer\n- 3 | https://example.test/1 | Acme | Engineer\n',
  );
  result = audit(dir);
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(
    result.removedDuplicates.map(d => d.removed),
    ['3'],
  );
  put('data/pipeline.md', '## Pending\n- 1 | https://example.test/wrong | Other | Engineer\n');
  assert.ok(audit(dir).errors.some(e => e.includes('Conflicting URL')));
  put('batch/tracker-additions/3.tsv', 'unmerged');
  assert.ok(audit(dir).errors.some(e => e.includes('Unmerged')));
  console.log(
    'Legacy audit tests passed: ID normalization, tracker precedence, unknown values, conflicts and outstanding results',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
