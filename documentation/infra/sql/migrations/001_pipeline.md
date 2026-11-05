# infra/sql/migrations/001_pipeline.sql

**Authority:** [infra/sql/migrations/001_pipeline.sql](../../../../infra/sql/migrations/001_pipeline.sql).

Creates the operational job pipeline schema and SQL write contracts.

## Inputs

Applied once, in numbered order, by `src/helpers/db-migrate.mjs`. Migration checksums make applied files immutable.

## Outputs and behavior

Creates jobs, evaluations, status events, workflow leases, scan history and legacy-import receipts with indexes/constraints. Functions allocate jobs by unique URL, transition statuses with revision checks, acquire expiring leases and complete evaluations idempotently while preserving intervening manual statuses.

## Dependencies and callers

Used by Node and Go database clients. Permanent IDs, canonical statuses, scores and evaluation history belong here; readable files are artifacts. Amend behavior through a new migration, then regenerate `infra/sql/schema.sql`.

