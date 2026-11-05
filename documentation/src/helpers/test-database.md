# src/helpers/test-database.mjs

**Kind:** test
**Purpose:** The PostgreSQL integration test for the schema and its functions. It applies migrations into a throwaway schema, verifies migrations 007 and 008 recover only evidence-backed historical status dates while leaving unknown dates null, then exercises the legacy import (rollback and idempotency), `create_job` deduplication under concurrency, unique IDs, revision-checked status changes, `claim_work` leases, idempotent and lease-guarded `complete_evaluation`, transaction rollback, `sync_job_description` revisions and `update_job_metadata` conflicts. A few pure checks of the JD ID marker run first without a database.

## Run
`node src/helpers/test-database.mjs` (alias `npm run test:database`) with `TEST_DATABASE_URL` pointing at a database whose name starts with `career_ops_test_`; anything else is refused. Without the variable it prints `SKIPPED ...` and exits 0. Locally, `node src/helpers/db-test.mjs` sets the variable and runs it; in CI, `.github/workflows/database.yml` provides a service container. No Docker needed beyond the server itself.

## Reads
- Environment: `TEST_DATABASE_URL`
- `infra/sql/migrations/*.sql` (applied in order into the test schema)

## Writes
- PostgreSQL (test database only): creates schema `test_<uuid>`, sets `search_path` to it for the pool, runs all migrations there, inserts and truncates rows, and drops the schema `CASCADE` in `finally`

## Imports
- `src/lib/_database.mjs` (`root` only; it builds its own `pg.Pool`)
- `src/helpers/import-legacy.mjs` (`importRecords`)
- `src/lib/_job-descriptions.mjs` (`withJobID`, `jdJobID`)

## Used by
- `src/helpers/db-test.mjs`, `.github/workflows/database.yml`, `package.json` script `test:database`
- `src/test-all.mjs` (discovered; skips without the variable)

## Notes
- Key invariants asserted: 12 concurrent `create_job` calls with one URL yield one ID; of two concurrent `change_job_status` calls with the same revision exactly one succeeds; Discarded rejects an empty reason; `complete_evaluation` does not overwrite a status that was set manually while the job was leased; a reused operation key with a different score raises an idempotency error; an expired lease taken by a new owner makes the old owner's completion fail with a lease error. The competing status fixture uses the canonical Ghosted status.
- Migrations are executed as raw SQL against the schema-scoped pool, not via `db-migrate.mjs`, so `schema_migrations` is not involved.
- The import fixture deliberately uses a pre-layout `reports/missing.md` report path; the test only checks that the value round-trips.
