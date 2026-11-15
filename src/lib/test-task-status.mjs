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

  // An expected non-zero outcome: the record carries its code, the state stays failed.
  writeFileSync(record, JSON.stringify({ action: 'evaluate', number: 9, state: 'running' }));
  const worker = body => {
    writeFileSync(record, JSON.stringify({ action: 'evaluate', number: 9, state: 'running' }));
    return run(
      'import { setRunOutcome } from ' +
        JSON.stringify(pathToFileURL(join(here, '_task-status.mjs')).href) +
        ';\n' +
        body,
      2,
    );
  };
  saved = worker("setRunOutcome('LOCATION_REVIEW');\nprocess.exitCode = 2;\n");
  assert.equal(saved.state, 'failed');
  assert.equal(saved.exit_code, 2);
  assert.equal(saved.error_code, 'LOCATION_REVIEW');
  // The outcome may carry a short detail (the gate reason): stripped, capped, record only.
  saved = worker(
    "setRunOutcome('LOCATION_REVIEW', 'US only\\u0007\\n  remote ' + 'x'.repeat(400));\nprocess.exitCode = 2;\n",
  );
  assert.equal(saved.error_code, 'LOCATION_REVIEW');
  assert.equal(saved.detail.length, 300);
  assert.ok(saved.detail.startsWith('US only remote x'), saved.detail);
  saved = worker("setRunOutcome('LOCATION_REVIEW');\nprocess.exitCode = 2;\n");
  assert.equal(saved.detail, undefined, 'no detail means no field');
  const { cleanDetail } = await import('./_task-status.mjs');
  assert.equal(cleanDetail('  a\u0000b\n\nc  '), 'a b c');
  assert.equal(cleanDetail(''), null);
  assert.equal(cleanDetail(42), null);
  saved = worker('process.exitCode = 2;\n');
  assert.equal(saved.error_code, undefined, 'without an outcome the code is the generic one');
  saved = worker("setRunOutcome('bad code');\nprocess.exitCode = 2;\n");
  assert.equal(saved.error_code, undefined, 'a malformed code is ignored');
  const { terminalErrorCode, setRunOutcome } = await import('./_task-status.mjs');
  assert.equal(terminalErrorCode(0), null);
  assert.equal(terminalErrorCode(2), 'EXIT_NONZERO');
  setRunOutcome('LOCATION_REVIEW');
  assert.equal(terminalErrorCode(2), 'LOCATION_REVIEW', 'the beforeExit hook reports this code');
  assert.equal(terminalErrorCode(0), null, 'a clean exit never carries an outcome code');
  setRunOutcome(null);

  // Run-aware path: calls go through the injected query, are bounded, and never throw.
  const { createRunReporter } = await import('./_task-status.mjs');
  const runId = '11111111-2222-4333-8444-555555555555';
  const calls = [];
  const reporter = createRunReporter({
    runId,
    query: async (sql, args) => {
      calls.push([sql, args]);
      return [];
    },
  });
  await reporter.report('drafting', 2);
  await reporter.finish('completed', 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0][0], /report_browser_run/);
  assert.deepEqual(calls[0][1], [runId, 'drafting', 2]);
  assert.match(calls[1][0], /finish_browser_run/);
  assert.deepEqual(calls[1][1], [runId, 'completed', 0, null]);
  const off = [];
  const disabled = createRunReporter({ runId: 'not-a-uuid', query: async (...a) => off.push(a) });
  await disabled.report('x', 1);
  await disabled.finish('failed', 1, 'EXIT_NONZERO');
  assert.equal(off.length, 0, 'an invalid run id disables reporting');
  const failing = createRunReporter({
    runId,
    query: async () => {
      throw new Error('driver detail');
    },
  });
  await assert.doesNotReject(failing.report('x', 1));
  await assert.doesNotReject(failing.finish('failed', 1));
  const started = Date.now();
  const hanging = createRunReporter({ runId, query: () => new Promise(() => {}), timeoutMs: 50 });
  await hanging.finish('completed', 0);
  assert.ok(Date.now() - started < 2000, 'a hung database call is bounded');

  // With CAREER_RUN_ID set and an unreachable database, the task still ends normally.
  writeFileSync(record, JSON.stringify({ action: 'cv', number: 7, state: 'running' }));
  const script = join(test, 'run-worker.mjs');
  writeFileSync(
    script,
    'import { reportPhase } from ' +
      JSON.stringify(pathToFileURL(join(here, '_task-status.mjs')).href) +
      "\nreportPhase('working');\n",
  );
  const guarded = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      CAREER_TASK_FILE: record,
      CAREER_RUN_ID: runId,
      DATABASE_URL: 'postgres://nobody@127.0.0.1:1/career_ops_test_unreachable',
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(guarded.status, 0, guarded.stderr);
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).state, 'completed');

  // No temporary files are left beside the record.
  assert.ok(!existsSync(record + '.tmp'));
  console.log(
    'Task status tests passed: no-op without a task file, phase/retry updates, and terminal state on clean exit and crash, and the bounded run-aware reporter.',
  );
} finally {
  if (dirname(test) !== resolve(tmpdir()) || !test.includes('career-task-status-'))
    throw new Error('refusing to remove ' + test);
  rmSync(test, { recursive: true, force: true });
}
