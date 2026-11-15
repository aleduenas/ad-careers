// Worker-side reporting for dashboard-launched tasks.
//
// The dashboard starts workers detached: it does not wait for them and does not
// own their lifetime, so a worker reports its own progress through the task
// record named by CAREER_TASK_FILE. Runs started from a terminal have no such
// record and every call here is a no-op.
//
// The dashboard writes the record once at launch; this process is its only
// writer afterwards. Writes are atomic (temporary file plus rename) so a reader
// never sees a half-written record.
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';

const file = process.env.CAREER_TASK_FILE || '';
const runId = process.env.CAREER_RUN_ID || '';
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let installed = false;
let outcomeCode = null;

// A launcher whose non-zero exit is an expected outcome (for example a job that needs a location
// decision) names it here; the terminal report then carries this code instead of EXIT_NONZERO.
// The state stays `failed` and the exit code is unchanged. Ignored on exit code 0.
export function setRunOutcome(errorCode) {
  outcomeCode =
    typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(errorCode) ? errorCode : null;
}

export function terminalErrorCode(exitCode) {
  return exitCode === 0 ? null : (outcomeCode ?? 'EXIT_NONZERO');
}

// Run-aware path. A task started from the browser dashboard also carries CAREER_RUN_ID; its
// progress and outcome are then mirrored into browser_runs through the existing pool. Every call
// is bounded, best effort and never throws, so a database problem cannot fail the task. The
// JSON record above stays the synchronous source of truth for the process exit itself.
export function createRunReporter({ runId: id, query, timeoutMs = 3000 }) {
  const enabled = typeof id === 'string' && RUN_ID_PATTERN.test(id);
  const bounded = async sql => {
    if (!enabled) return;
    let timer;
    try {
      const run = query ? query : (await import('./_database.mjs')).query;
      await Promise.race([
        sql(run),
        new Promise(resolve => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } catch {
      // Reporting is best effort.
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    enabled,
    report: (phase, attempt) =>
      bounded(run =>
        run('SELECT report_browser_run($1::uuid, $2::text, $3::integer)', [
          id,
          String(phase).slice(0, 80),
          attempt,
        ]),
      ),
    finish: (state, exitCode, errorCode = null) =>
      bounded(run =>
        run('SELECT finish_browser_run($1::uuid, $2::text, $3::integer, $4::text)', [
          id,
          state,
          exitCode,
          errorCode,
        ]),
      ),
  };
}

const runReporter = createRunReporter({ runId });
let runFinished = false;

function save(fields) {
  if (!file) return;
  let record = {};
  try {
    record = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // The dashboard always writes the record first; a missing or unreadable one
    // means this run is no longer being tracked, so start from what we know.
  }
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ ...record, ...fields, updated_at: new Date().toISOString() }),
    );
    renameSync(temporary, file);
  } catch {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // Reporting is best effort and never fails the task itself.
    }
  }
}

// reportPhase records what the task is doing now. attempt is 1 for a first try;
// anything higher is shown as a retry.
export function reportPhase(phase, attempt = 1) {
  install();
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  save({ state: 'running', phase: String(phase), attempt: safeAttempt });
  void runReporter.report(phase, safeAttempt);
}

// install registers the terminal-state reporter. It runs on the first report,
// and launchers call it at startup so that a task that dies before its first
// checkpoint is still recorded as failed rather than left running.
export function install() {
  if (installed || !file) return;
  installed = true;
  // A natural exit leaves the loop free for one bounded database call; process.exit() and
  // crashes skip it, and the server's exit observer or reconcile pass settles those runs.
  process.on('beforeExit', async code => {
    if (!runReporter.enabled || runFinished) return;
    runFinished = true;
    const exitCode = code || process.exitCode || 0;
    await runReporter.finish(
      exitCode === 0 ? 'completed' : 'failed',
      exitCode,
      terminalErrorCode(exitCode),
    );
  });
  process.on('exit', code => {
    save({
      state: code === 0 ? 'completed' : 'failed',
      exit_code: code,
      ...(code !== 0 && outcomeCode ? { error_code: outcomeCode } : {}),
      finished_at: new Date().toISOString(),
    });
  });
}

install();
