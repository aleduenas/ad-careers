# infra/sql/migrations/003_job_descriptions.sql

**Authority:** [infra/sql/migrations/003_job_descriptions.sql](../../../../infra/sql/migrations/003_job_descriptions.sql).

Adds database-backed canonical JD text.

## Inputs

Creates one `job_descriptions` row per job with nonempty content, file path, content hash, revision and sync timestamp. `sync_job_description` requires an existing job.

## Outputs and behavior

Upserts changed content/path, increments description revision when changed, and synchronizes `jobs.jd_path`; unchanged input is idempotent. Returns the stored description.

## Dependencies and callers

Applied by `db-migrate.mjs`; used by `_job-descriptions.mjs`, ingestion, evaluation and drafting, and read directly by the dashboard. A hash-only difference does not trigger an update. Applied migration is immutable.

