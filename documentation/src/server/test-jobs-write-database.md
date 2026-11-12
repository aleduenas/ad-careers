# src/server/test-jobs-write-database.mjs

**Authority:** [src/server/test-jobs-write-database.mjs](../../../src/server/test-jobs-write-database.mjs).

PostgreSQL integration for the job writes and the Ghosted rule, in a UUID-named schema of a
`career_ops_test_` database with the real migrations and synthetic jobs. Run with
`node src/server/test-jobs-write-database.mjs` and `TEST_DATABASE_URL`; without it the test prints
`SKIPPED`. `node src/helpers/db-test.mjs` runs it as a child.

Covers: every status transition through `change_job_status` (revision +1 each time, reason
appended to notes, `applied_at` reset on a return to Applied (not earlier than the first), dashboard actor on every event); the
discard-reason rule in the API and the SQL function; revision conflict with the current job;
company, role and URL field guards and conflicts (a status change elsewhere does not block them);
URL uniqueness with `url_key` kept in step and unchanged on rejection; salary set, partial guard,
exact large decimals and clear; JD creation from nothing, revision and hash progression, unchanged
text, conflicts, rejected tags and the cache file; and the ghosting boundary (just over 40 days,
well past, just under, recent, null `applied_at`, other statuses, the event text, a second pass
moving nothing). Snapshots prove evaluations, claims and runs are untouched.
