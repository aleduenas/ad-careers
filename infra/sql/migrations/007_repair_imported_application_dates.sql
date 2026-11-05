-- Migration 006 initially treated legacy-import status events as application
-- events. Those events record the PostgreSQL cutover time, not the historical
-- application time. Recover only dates explicitly preserved by the old
-- move-status command in notes; leave all other historical dates unknown.
WITH imported_applied AS (
  SELECT job.id,
    (regexp_match(job.notes, '(?i)Applied[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1] AS application_date
  FROM jobs AS job
  WHERE EXISTS (
    SELECT 1
    FROM job_status_events AS event
    WHERE event.job_id=job.id
      AND event.actor='migration'
      AND event.new_status='Applied'
      AND event.created_at=job.applied_at
  )
)
UPDATE jobs AS job
SET applied_at=CASE
      WHEN imported.application_date IS NULL THEN NULL
      ELSE imported.application_date::date::timestamp AT TIME ZONE 'America/Toronto'
    END,
    revision=job.revision+1,
    updated_at=now()
FROM imported_applied AS imported
WHERE job.id=imported.id;
