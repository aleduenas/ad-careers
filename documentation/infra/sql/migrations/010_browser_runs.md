# 010_browser_runs.sql

**Authority:** `infra/sql/migrations/010_browser_runs.sql` and
`documentation/dashboard-migration/design/STAGE3_TASKS_CONTRACT.md` (D041).

Additive migration for browser-launched work. It creates one table and four functions and
changes nothing that exists. It never writes to `jobs`, `evaluations`, `job_status_events` or
`job_descriptions`, and run states are their own vocabulary, never job statuses.

## browser_runs

One row per dispatched run. `request_key` is unique and is the client idempotency key. `action`
is one of `evaluate`, `cv`, `letter`, `scan`, `intake`, `publish`. `job_id` is an optional foreign
key to `jobs`. `state` is `queued`, `running`, `completed`, `failed` or `interrupted`; a CHECK
ties `finished_at` to the three terminal states. `log_ref` must be a plain file name (letters,
digits, dot, dash, underscore; no separators, no `..`). `error_code` holds safe public codes only.
`selection` is a versioned jsonb provider/model record. Indexes cover active rows, per-job
history, recency and groups.

## Functions

All lock the row with `FOR UPDATE`; a call that no longer applies returns the row unchanged.

- `start_browser_run(id, pid, pid_started_at)`: queued to running once; phase becomes `running`.
- `report_browser_run(id, phase, attempt)`: running rows only; a lower attempt is ignored.
- `finish_browser_run(id, state, exit_code, error_code)`: queued or running to a terminal state,
  once. `queued`/`running` are rejected as targets.
- `interrupt_stale_browser_runs(now, dead_pids)`: marks running rows whose pid is in the list
  (`PROCESS_GONE`) or whose `started_at` is over 24 hours before `now` (`STALE_24H`) as
  `interrupted` and returns them. The pid list is an addition to the contract's `(now)`
  signature: the server proves liveness, the database does not.

## Rollback (non-destructive)

Rollback is a new migration, never an edit. Before it, stop the dashboard server so no run is
written. To retire the feature while keeping evidence, leave `browser_runs` in place (nothing else
references it) and ship server code that no longer calls the functions. To remove it entirely:
`pg_dump -t browser_runs` first, then a numbered migration that drops the four functions and the
table. Existing job data is unaffected either way. Never apply to the personal database except
through the documented migration command.
