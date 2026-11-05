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
let installed = false;

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
  save({ state: 'running', phase: String(phase), attempt: Math.max(1, Number(attempt) || 1) });
}

// install registers the terminal-state reporter. It runs on the first report,
// and launchers call it at startup so that a task that dies before its first
// checkpoint is still recorded as failed rather than left running.
export function install() {
  if (installed || !file) return;
  installed = true;
  process.on('exit', code => {
    save({
      state: code === 0 ? 'completed' : 'failed',
      exit_code: code,
      finished_at: new Date().toISOString(),
    });
  });
}

install();
