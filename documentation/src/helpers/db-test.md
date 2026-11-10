# src/helpers/db-test.mjs

**Authority:** [src/helpers/db-test.mjs](../../../src/helpers/db-test.mjs).

Isolated integration runner.

## Run and callers

Run `node src/helpers/db-test.mjs` with the local Compose service up, Go installed and Playwright Chromium installed.

## Inputs

Reads root database connection settings only to provision `career_ops_test_integration`. Sets `TEST_DATABASE_URL` for child suites; the personal database is never their test target.

## Behavior and outputs

Runs legacy-import, database, jobs read-model, evaluation-launcher, drafting/publishing and backup/restore suites, then `go test ./...`. Fixtures use temporary schemas/directories. Any child failure stops the runner. Used by npm `db:test`, cutover and database CI. The jobs read-model suite uses synthetic PostgreSQL rows in its own temporary schema and injected synthetic material/compensation adapters. The drafting test uses synthetic model output but real Node processes, PostgreSQL and Chromium.
