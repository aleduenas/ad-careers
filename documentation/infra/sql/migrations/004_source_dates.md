# infra/sql/migrations/004_source_dates.sql

**Authority:** [infra/sql/migrations/004_source_dates.sql](../../../../infra/sql/migrations/004_source_dates.sql).

Adds explicit source dates for new ingestion while preserving legacy callers.

## Inputs

Adds a six-argument `create_job` overload with `p_source_date`; the five-argument function remains available.

## Outputs and behavior

New jobs record the supplied source date. Backfills only null dates whose stored JD contains manual-paste source and a fetched date; unknown historical dates remain null.

## Dependencies and callers

Applied by `db-migrate.mjs`; used by current ingestion through `_database.mjs`. Duplicate normalized URLs still return the existing job. Applied migration is immutable.

