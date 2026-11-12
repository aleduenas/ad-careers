# src/lib/_task-status.mjs

**Authority:** [src/lib/_task-status.mjs](../../../src/lib/_task-status.mjs).

Worker-side progress reporting for dashboard-launched tasks.

## Run and callers

No standalone command. Imported by `src/eval/evaluate-jobs.mjs`, `src/eval/_evaluation-cli.mjs`, `src/cvgen/draft-cv.mjs` and `src/cvgen/draft-cover-letter.mjs`.

## Inputs

`CAREER_TASK_FILE` names the task record to update. The dashboard sets it when it launches a worker; a run started from a terminal has no such record and every call here is a no-op, so scripts behave identically either way.

## Behavior and outputs

`reportPhase(phase, attempt)` records what the task is doing and which attempt it is on: an attempt above 1 is shown as a retry in the dashboard. Importing the module registers the terminal-state reporter, so a worker that exits — cleanly, by throwing, or before its first checkpoint — records `completed` or `failed` with its exit code and finishing time. Writes merge into the existing record and are atomic (temporary file plus rename), so the dashboard never reads a half-written record. Reporting is best effort: a failure to write never fails the task. The dashboard writes the record once at launch and this process is its only writer afterwards.

## Run-aware path

When `CAREER_RUN_ID` (a UUID) is also set, the task was launched from the browser dashboard and `createRunReporter` mirrors it into `browser_runs` through the shared pool: `reportPhase` calls `report_browser_run`, and a natural exit (the `beforeExit` event) calls `finish_browser_run` (`completed`, or `failed` with `EXIT_NONZERO`). Every database call is bounded to 3 s, swallows all errors and never changes the task's exit, so an unreachable database cannot fail the task. A hard `process.exit()` or crash cannot await a query; those runs are settled by the server's exit observer or its reconcile pass, which reads the JSON record. The JSON record behaves exactly as before, and a terminal run without these variables is unchanged.
