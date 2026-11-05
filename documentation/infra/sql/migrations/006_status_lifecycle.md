# infra/sql/migrations/006_status_lifecycle.sql

**Authority:** [infra/sql/migrations/006_status_lifecycle.sql](../../../../infra/sql/migrations/006_status_lifecycle.sql).

Merges the retired `SKIP` status into `Discarded`, adds `Ghosted` to the canonical job statuses, and limits evaluation results to `Evaluated` or `Discarded`. Existing job, evaluation and status-event rows are migrated in place.

The migration also backfills a missing `applied_at` from the earliest recorded Applied transition, updates `change_job_status` so entering Applied records the application time and Discarded requires a non-empty reason, and defines `ghost_stale_applications()`. That function revision-safely moves jobs still in Applied more than 40 days after `applied_at` to Ghosted and records an automatic status event. Migration 007 corrects this backfill for legacy import events, whose timestamps represented database cutover rather than real application dates.

Applied once, in numbered order, by `src/helpers/db-migrate.mjs`. The dashboard invokes the ghosting function before loading its rows.
