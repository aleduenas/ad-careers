# dashboard/internal/data/database_test.go

**Authority:** [dashboard/internal/data/database_test.go](../../../../dashboard/internal/data/database_test.go).

Exercises the PostgreSQL dashboard lifecycle: loading applications/JDs, Toronto-local current-status occurrence dates (including a UTC date-boundary case), automatic 40-day ghosting, status transitions, discard reasons, revision handling and persisted data.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Requires `TEST_DATABASE_URL` and skips when absent. Run through `node src/helpers/db-test.mjs` for an isolated database, never the personal database. Uses `database/sql`, pgx and data/model helpers and writes integration fixtures.
