# src/server/readiness.mjs

**Authority:** database schema is `infra/sql/schema.sql`; readiness behavior is the Stage 1
contract in `documentation/dashboard-migration/design/STAGE1_CONTRACT.md`.

Exports `createReadinessCheck({query})` for injected transports and a default `checkReadiness`
that reuses `src/lib/_database.mjs`'s read-only `query()`. One catalog query verifies the core job,
evaluation, status-event and JD tables plus existing job creation/status functions. The catalog names are cast to `text` (a `name[]` compared with `text[]` fails on PostgreSQL 17) and
the schema is a bound parameter, `public` by default. A connection, authentication, resource or
timeout failure (no SQLSTATE, or class 08, 28, 3D, 53, 57, 58) becomes a safe
`DatabaseUnavailableError`. Any other SQLSTATE is a SQL error, a bug or broken catalog, and becomes
`SchemaNotReadyError` with the driver error kept only as `cause`; the public message stays generic.
Missing objects are also `SchemaNotReadyError`. It never
migrates, seeds, refreshes statuses or reads job/candidate records.

**Tests:** `node --test src/server/test-app.mjs` injects synthetic query results and error codes.
`node src/server/test-readiness-database.mjs` (run by `node src/helpers/db-test.mjs`, skipped without
`TEST_DATABASE_URL`) runs the real SQL against an isolated schema: ready, SQL error, missing column
and dead connection.
