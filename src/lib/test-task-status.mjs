import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const test = mkdtempSync(join(tmpdir(), 'career-task-status-'));
try {
  // Reporting is a no-op without a task file, so terminal runs are unaffected.
  const { reportPhase } = await import('./_task-status.mjs');
  reportPhase('ignored');

  const record = join(test, 'task.json');
  const run = (body, expectedCode) => {
    const script = join(test, 'worker.mjs');
    writeFileSync(
      script,
      'import { reportPhase } from ' +
        JSON.stringify(pathToFileURL(join(here, '_task-status.mjs')).href) +
        ';\n' +
        body,
    );
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, CAREER_TASK_FILE: record },
      encoding: 'utf8',
    });
    assert.equal(result.status, expectedCode, result.stderr);
    return JSON.parse(readFileSync(record, 'utf8'));
  };

  writeFileSync(
    record,
    JSON.stringify({ action: 'cv', number: 1152, state: 'running', phase: 'starting', attempt: 1 }),
  );
  let saved = run(
    "reportPhase('drafting worksheet');\nreportPhase('repairing worksheet', 2);\n",
    0,
  );
  assert.equal(saved.action, 'cv', 'the dashboard-written fields survive worker updates');
  assert.equal(saved.phase, 'repairing worksheet');
  assert.equal(saved.attempt, 2);
  assert.equal(saved.state, 'completed', 'a clean exit reports completion');
  assert.equal(saved.exit_code, 0);
  assert.ok(saved.finished_at && saved.updated_at);

  // A crash still reports a terminal state, including before any checkpoint.
  saved = run("throw new Error('worker exploded');\n", 1);
  assert.equal(saved.state, 'failed');
  assert.equal(saved.exit_code, 1);
  assert.equal(saved.number, 1152, 'the record keeps identifying its job after a crash');

  // No temporary files are left beside the record.
  assert.ok(!existsSync(record + '.tmp'));
  console.log(
    'Task status tests passed: no-op without a task file, phase/retry updates, and terminal state on clean exit and crash.',
  );
} finally {
  if (dirname(test) !== resolve(tmpdir()) || !test.includes('career-task-status-'))
    throw new Error('refusing to remove ' + test);
  rmSync(test, { recursive: true, force: true });
}
