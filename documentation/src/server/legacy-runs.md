# src/server/legacy-runs.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_TASKS_CONTRACT.md`. The Go TUI is
retired (see `documentation/history/tui-retirement-2026-11.md`); its records stay listed read-only.

Read-only view of the JSON task records the retired Go TUI left in `logs/dashboard/tasks/`. It
writes, deletes and signals nothing.

## Record format

The TUI launched detached workers, so a record plus the liveness of its owning process was the only
authority on what ran. Records live in `logs/dashboard/tasks/*.json`, task logs in
`logs/dashboard/*.log`. States are `running`, `completed` and `failed`, written by the worker through
`src/lib/_task-status.mjs`, plus reader-decided `interrupted` (a `running` record whose owner is gone,
or that is more than a day old, which guards against a recycled process ID) and `unrecorded` (a log
with no record, from before the registry; the browser list does not show these). Records are pruned
with the rest of `logs/dashboard` by `src/helpers/prune-logs.mjs`. The TUI wrote records atomically
(temporary file plus rename) and ordered them newest activity first.

**Exports (shared with the 4.2 audit helper):**
- `parseLegacyRecord(text, fileName)` returns `{ ok: true, record }` or `{ ok: false, reason }`.
  A record needs a known action (evaluate, cv, letter, both, scan, intake, publish), a known state
  (running, completed, failed, interrupted), non-negative integer number, pid and attempt (at least
  1), an integer exit code and valid timestamps. `record.browserRun` is true when the record has a
  `run_id` or its file name ends in an 8-hex tail (browser runs write their own record).
- `classifyLegacyRecord(record, { now, isAlive, processStartTime })` returns the effective
  `{ state, errorCode }`. A recorded `running` reads as `interrupted` when it is older than 24 h
  (`STALE_24H`), has no pid or a dead owner, or the live pid started outside -5 s to +30 s of the
  recorded `started_at` (recycled pid; `PROCESS_GONE`). Nothing is written back.
- `legacyWireRun`, `legacyRunId(stem)` (a stable UUID from the file name), `LEGACY_ACTIONS` and the
  horizon constants.
- `createLegacyRuns({ rootDir, isAlive, processStartTime, now })` returns `{ list, find, stats }`.
  Liveness adapters are injected so this module never imports `runs.mjs`.

**Wire shape:** the same as a browser run with `source: 'legacy'`, `requestKey` `legacy:<stem>`, no
group, empty selection, `jobId` only when the number is above zero, no pid and no log path. `list({
jobId, limit })` returns every running row then the newest `limit` terminal rows (default 12).
`find(id)` returns `{ run, logRef }` where `logRef` is only the log file name from the record; the
caller always reads `logs/dashboard/<name>`.

**Defensive reading:** files must be regular (no links), at most 64 KB, at most 5000 per folder.
Malformed records are skipped and counted in `stats().skipped`, never thrown. Browser-run records
are skipped so a run is not listed twice. Parsed files are cached by size and modified time;
liveness is always recomputed.

**Used by:** `runs.mjs` appends legacy rows after browser rows in `list()` (the terminal limit covers
both sources), answers `get` and `log` for a legacy id, and a failing legacy folder never hides
browser runs. Browser dispatch now writes `run_id` in its own record.

**Tests:** `node --test src/server/test-legacy-runs.mjs`.
