# src/server/test-jobs-database.mjs

**Authority:** [src/server/test-jobs-database.mjs](../../../src/server/test-jobs-database.mjs).

PostgreSQL integration coverage for the jobs read model. The test uses synthetic rows and the actual
numbered migrations in an isolated temporary schema. It injects a SELECT-only SQL adapter plus
synthetic material and compensation adapters, so no candidate files are read.

## Run

`node src/server/test-jobs-database.mjs` with `TEST_DATABASE_URL` naming a database whose name
starts with `career_ops_test_`. Without the variable, it prints `SKIPPED` and exits successfully;
other database names are refused before connecting. The documented `node src/helpers/db-test.mjs`
runner provisions the dedicated `career_ops_test_integration` database if needed and passes its
URL to this suite.

## Coverage

Checks canonical status filtering, large decimal-string IDs and revisions, source/history date
precedence, Toronto status-date conversion and null-event handling, literal Unicode/ID/notes/reason
search, stable grouping and material promotion, cursor paging/tampering/fingerprint/stale-offset
handling, manual salary precision and partial salary retention, overview formulas, and safe wire
projections. The job detail reader is exercised against the same fixtures (JD without its file path, evaluation
history, status events in ID order with a null occurrence time, discard reason, bigint IDs,
unknown IDs). A before/after snapshot verifies that jobs, status events, evaluations, and job
descriptions are unchanged by reads.

## Isolation and writes

The suite reads `TEST_DATABASE_URL` only. It validates the `career_ops_test_` database name before
connecting, creates a UUID-named schema, applies migrations and synthetic fixtures there, and drops
only that schema in `finally`. Its injected read adapter asserts the SQL is exactly the reader's
SELECT query. The injected material and compensation adapters return synthetic values and do not
touch the filesystem.
