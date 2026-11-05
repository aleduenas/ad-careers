# src/helpers/db-migrate.mjs

**Kind:** admin command
**Purpose:** Applies the numbered SQL migrations in `infra/sql/migrations/` to the configured database, in filename order, inside one transaction guarded by an advisory lock. It records each applied file's SHA-256 in `schema_migrations` and refuses to continue if an already-applied file has changed, which enforces layout rule 9 (migrations are immutable).

## Run
`node src/helpers/db-migrate.mjs` (alias `npm run db:migrate`). No flags. Needs a reachable PostgreSQL (`.env` or `DATABASE_URL`).

## Reads
- `infra/sql/migrations/*.sql` (sorted by name)
- PostgreSQL: `schema_migrations`

## Writes
- PostgreSQL: creates `schema_migrations(name, checksum, applied_at)` if missing; executes each pending migration; inserts one row per applied file

## Imports
- `src/lib/_database.mjs` (`root`, `transaction`, `close`)

## Used by
- `package.json` script `db:migrate`
- `src/helpers/db-cutover.mjs` (step 2)

## Notes
- The whole run is one transaction: a failing migration rolls back everything applied in that run, and `pg_advisory_xact_lock(71938201)` serialises concurrent invocations (the same lock ID is used by `import-legacy.mjs`).
- Idempotent: re-running with no new files applies nothing and prints nothing.
- The generated `infra/sql/schema.sql` is not consulted here; keep it in sync with `src/helpers/db-schema.mjs`.
