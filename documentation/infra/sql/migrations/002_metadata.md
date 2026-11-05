# infra/sql/migrations/002_metadata.sql

**Authority:** [infra/sql/migrations/002_metadata.sql](../../../../infra/sql/migrations/002_metadata.sql).

Adds revision-checked job metadata edits.

## Inputs

`update_job_metadata(id, revision, role, note)` locks the existing job, rejects unknown IDs, stale revisions and empty supplied role titles.

## Outputs and behavior

Updates the role, appends a nonempty note, increments revision and refreshes `updated_at`; returns the job.

## Dependencies and callers

Applied by `db-migrate.mjs`; consumed through `_database.mjs` and `job-update.mjs`. Does not transition application status. Applied migration is immutable.

