# src/helpers/db-schema.mjs

**Kind:** admin command
**Purpose:** Regenerates `infra/sql/schema.sql` as the concatenation of every migration in `infra/sql/migrations/` (sorted, LF-normalised, each prefixed with a `-- <filename>` header), or verifies that the snapshot already matches. It exists so the snapshot is never hand-edited and CI can detect a stale one.

## Run
- `node src/helpers/db-schema.mjs` (alias `npm run db:schema`): rewrite the snapshot
- `node src/helpers/db-schema.mjs --check`: exit non-zero with "Schema snapshot differs; run npm run db:schema" if the file is out of date

No database connection is opened.

## Reads
- `infra/sql/migrations/*.sql`
- `infra/sql/schema.sql` (only in `--check` mode)

## Writes
- `infra/sql/schema.sql` (default mode only)

## Imports
- `src/lib/_database.mjs` (`root` only)

## Used by
- `package.json` script `db:schema`
- `.github/workflows/database.yml` (`--check` step)

## Notes
- The first line of the generated file is `-- Generated from numbered migrations. Do not edit directly.`
- Comparison in `--check` normalises CRLF on the existing file, so Windows line endings in the snapshot do not cause false failures.
