# src/server/test-intake-database.mjs

**Authority:** [src/server/test-intake-database.mjs](../../../src/server/test-intake-database.mjs).

PostgreSQL integration for pasted intake and scan runs, in a UUID-named schema of a
`career_ops_test_` database with the real migrations and synthetic data. The real
`add-pasted-jd.mjs` runs as a child process with `DATABASE_URL` pointed at that schema. Run with
`node src/server/test-intake-database.mjs` and `TEST_DATABASE_URL`; without it the test prints
`SKIPPED`. `node src/helpers/db-test.mjs` runs it as a child.

Covers: `check` against a tracked URL (scheme and `www` ignored), a seen-only URL (newest
sighting), nothing and garbage; company suggestions from both tables; the launcher validation
messages through the real script; a real `--dry-run` (canonical company spelling, planned path, no
file, no job, no history row); `DUPLICATE_JOB` with and without `force`; `SEEN_URL` and the forced
add; a real intake (Pending job, JD stored byte for byte in `job_descriptions` and the cache file,
`added` history row, workspace id, lock released) and its repeat as a duplicate; and a scan run
through the real store with a synthetic scan script and fixture report: selection stored, second
scan and real intake refused with `DISCOVERY_BUSY` and the run id, preview allowed, the report
route, and intake and scans allowed again afterwards. The only repository files written are the
synthetic JD files under a unique `data/jds/zz-intake-*` folder, removed in `finally`.
