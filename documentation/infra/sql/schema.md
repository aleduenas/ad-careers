# infra/sql/schema.sql

**Authority:** [infra/sql/schema.sql](../../../infra/sql/schema.sql).

Provides the generated, reviewable SQL schema snapshot.

## Inputs

Generated from ordered `infra/sql/migrations/*.sql` by `node src/helpers/db-schema.mjs`; `--check` verifies the snapshot without rewriting.

## Outputs and behavior

Contains the consolidated migration SQL, including path rewrites and separate recorded/occurred timestamps for status events. Do not hand-edit this generated file or use it as a substitute for migration tracking.

## Dependencies and callers

Used for review, tests and status/constraint reference. Migration files are authoritative; `db-migrate.mjs` applies them with checksums.
