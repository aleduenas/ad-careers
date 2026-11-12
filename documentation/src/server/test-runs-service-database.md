# src/server/test-runs-service-database.mjs

**Authority:** [src/server/test-runs-service-database.mjs](../../../src/server/test-runs-service-database.mjs).

PostgreSQL integration for `runs.mjs` wired to the real `createRunsStore`. Applies the numbered
migrations in a UUID-named schema of a `career_ops_test_` database, creates one synthetic job and
runs a service over a temporary root holding synthetic launcher scripts (never a real launcher or
LLM).

## Run

`node src/server/test-runs-service-database.mjs` with `TEST_DATABASE_URL`; without it the test
prints `SKIPPED` and exits 0, and other database names are refused. `node src/helpers/db-test.mjs`
runs it as a child against `career_ops_test_integration`.

## Coverage

`ready()` against the schema; dispatch observed `running` then `completed` through the real SQL
functions with pid and start time stored; log tail of the synthetic output; same-key replay and
409 through the real unique constraint; unknown job 404; an `evaluate`-pair sharing one group; a
dead-pid run interrupted `PROCESS_GONE` by `reconcile` while a live process and terminal rows are
left alone; the list read. Dispatch prerequisites run against real rows (Pending with and without a
JD, Evaluated with a report file, high and low scores, no report): the detail `actions` block, the
fixed reasons and `PREREQUISITE_FAILED` with nothing recorded; the active-run rule through the
real `browser_runs` query (`RUN_ACTIVE`, replay not blocked, pair blocked by an active child,
available again once finished); and a one-run override stored in the real jsonb column. Snapshots of jobs, evaluations, status events and job descriptions
before and after prove no business table changed.

Stage 3.5: the `publish` run row through the real store with a synthetic launcher and the real
letter service over a temporary root: no letter is refused, a stale hash records nothing, the row has
the job and an empty selection, a save and a second publish are `RUN_ACTIVE` through the real
`browser_runs` query while it runs, and after completion a save works and the old hash is a conflict.
