# src/server/test-runs-database.mjs

**Authority:** [src/server/test-runs-database.mjs](../../../src/server/test-runs-database.mjs).

Isolated PostgreSQL coverage for migration 010 and `runs-store.mjs`. It applies every numbered
migration into a UUID-named schema on a `career_ops_test_` database, and drops only that schema in
`finally`. Without `TEST_DATABASE_URL` it prints `SKIPPED`; other database names are refused.
Run it through `node src/helpers/db-test.mjs`.

Coverage: insert shape and defaults; duplicate request key (including 10 concurrent inserts, one
winner); unknown job, bad action and unsafe `log_ref`; start once, forward-only reports, terminal
once-only, no-ops after terminal; direct queued-to-failed; concurrent start and finish races;
dead-pid and 24 h interruption leaving queued, alive and terminal rows alone; a fresh pool
(restart) reading the same state; list rules and job filter; row-level job-status vocabulary
rejection; and before/after snapshots proving jobs, evaluations, status events, job descriptions
and workflow claims are unchanged by any run write.
