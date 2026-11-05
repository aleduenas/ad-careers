# infra/sql/migrations/008_status_event_occurrence.sql

**Authority:** [infra/sql/migrations/008_status_event_occurrence.sql](../../../../infra/sql/migrations/008_status_event_occurrence.sql).

## Purpose

Separates the time a status transition occurred from the time its event row was recorded, so the PostgreSQL cutover date is never presented as a historical workflow date.

## Behavior

Adds nullable `job_status_events.occurred_at` with a `now()` default for future events. Existing non-migration events use their recording time. Legacy import events recover occurrence dates only from evidence preserved before cutover: repaired application dates, dated evaluation report paths, or explicit status/date notes. Unrecoverable history remains null.

## Dependencies and callers

Runs after migration 007 so repaired `applied_at` values are available. The dashboard reads `occurred_at`; transition functions inherit the default for future event inserts.
