# src/lib/test-llm-usage-database.mjs

**Kind:** database integration test
**Purpose:** Proves migration 011, the recording and read queries and the backfill against the isolated test database.

## Run
Needs `TEST_DATABASE_URL` naming a `career_ops_test_*` database (it refuses anything else and skips without it). It is run by `node src/helpers/db-test.mjs` once its path is listed there. Everything happens in a unique schema that is dropped afterwards.

## Covers
- Migrations apply in order; an empty database aggregates to zeros and empty lists.
- Inserts for both providers, the `usage_missing` row, and the CHECK and foreign-key constraints enforced by PostgreSQL.
- Totals, per model, per function, per job (company and role joined) and per day for 7d, 30d and all; range and job id validation; newest-first limit.
- Race: 12 concurrent inserts of one `log_ref` leave exactly one row.
- Backfill from fixture logs: function, provider, job id (unknown job becomes null), model and timestamp derivation; first run inserts, second run inserts nothing; no job, evaluation, status-event or JD row is touched.
- Job repair: only a null-job row is a candidate, it gets the job its path yields, a set job id is never overwritten, a rerun repairs nothing.
- Restart: a new connection pool sees the same rows and still deduplicates.
- `cubeCalls` grouping, joined company and role, reported-cost sums and counts, and `countCalls` against `readCalls`' filter.
