# src/server/readiness.mjs

**Authority:** database schema is `infra/sql/schema.sql`; readiness behavior is the Stage 1
contract in `documentation/dashboard-migration/design/STAGE1_CONTRACT.md`.

Exports `createReadinessCheck({query})` for injected transports and a default `checkReadiness`
that reuses `src/lib/_database.mjs`'s read-only `query()`. One catalog query verifies the core job,
evaluation, status-event and JD tables plus existing job creation/status functions. Query errors
become a safe `DatabaseUnavailableError`; missing objects become `SchemaNotReadyError`. It never
migrates, seeds, refreshes statuses or reads job/candidate records.

**Tests:** `node --test src/server/test-app.mjs` injects synthetic query results and an error
sentinel. No real database is required.
