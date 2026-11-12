# src/server/test-runs.mjs

**Kind:** synthetic Node test suite for `src/server/runs.mjs`.

Run with `node --test src/server/test-runs.mjs`. An in-memory store with the SQL functions'
once-only, forward-only semantics stands in for PostgreSQL, a temporary repository root holds
synthetic launcher scripts, and the real `child_process.spawn` runs them (never a real launcher
or LLM). Cases: dispatch argv, options and environment, pid recording and the legacy task record;
exit observation (completed, failed with its code); duplicate request key (same digest replays
without a second spawn, different job or action is 409); `both` grouping; request validation and
unknown job; spawn failure (missing launcher, throw, async error); reconcile for dead pid, 24 h
rows, live rows, a worker record that finished while the server was down, and terminal rows;
restart recovery with a real worker process; log tail bounds, line alignment, offset cursor,
missing log and redaction of keys, tokens, URLs and paths; wire shape; `ready` and safe database
errors; periodic reconcile start and stop. Dispatch rules: the prerequisite re-check (409 `PREREQUISITE_FAILED` with the fresh actions, nothing
recorded, 404 for an unknown job), the active-run rule (`RUN_ACTIVE` with the id for the same job
and action only, queued rows counted), replay ignoring checks and overrides, a pair checking only
its missing child, the override validation matrix, merge per action and for a pair, the stored
selection equal to the flags a synthetic worker received, one child failing without cancelling the
other, concurrent dispatches starting exactly one, and the wire selection projection. Provider selection: stored on the run and passed as flags for evaluate, cv and letter (and per action
for `both`), malformed entries dropped, no adapter unchanged, a failing adapter records nothing.
Scan runs: argv with the report path, selection stored and replayed or conflicted, field validation,
a company value kept literal in one argv element, the discovery lock and active-scan refusal
(DISCOVERY_BUSY with the run id, job actions unaffected, an intake holding the lock), and the
projected, redacted and bounded scan report (404 while absent, corrupt, oversized or for other
runs). Also: a stale queued row is interrupted and a fresh one left alone; the pid is recorded right after
spawn and a failing `start` call still leaves the worker observed; JSON-quoted, flag, session and
bare-password secrets are redacted while ordinary lines are untouched. Liveness: a live pid with a start time off by more than the tolerance is treated as recycled, an
unreadable start time falls back to alive, and `readProcessStartTime` is checked with a fake
executor (argv call, parsing, failures, invalid pids, non-Windows). No database or personal data
is used.

Stage 3.5 cases: publish dispatch with the exact argv, job set, empty selection and no provider
resolution; the hash guard and vanished letter; prerequisites and the active-run rule (publish and
letter block, other actions and jobs do not); replay and key conflicts; request validation and 503
without a letter service; a failing launcher ending `failed`; and the JSON-escaped path in
`redactLog`.

The runs list `limit` parameter (3.6) is covered in `test-runs.mjs` and `test-app.mjs`.

Legacy rows: merge into `list()`, `get`, `log`, the limit across sources, a failing legacy source, and the `run_id` record.

F20 tests: a missing provider is 409 before any row and is cached for 60 s, an installed one dispatches after expiry, and the default probe maps only a failed start to missing and returns just the command file name.
