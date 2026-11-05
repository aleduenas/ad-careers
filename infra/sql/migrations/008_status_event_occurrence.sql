-- Distinguish when a transition happened from when its history row was
-- recorded. Legacy rows were inserted during the PostgreSQL cutover, so their
-- created_at values are not evidence of the original transition date.
ALTER TABLE job_status_events ADD COLUMN occurred_at timestamptz;

-- Native PostgreSQL transitions were recorded at the time they happened.
UPDATE job_status_events
SET occurred_at = created_at
WHERE actor <> 'migration';

-- Recover legacy dates only from evidence preserved before the cutover.
-- Application dates were repaired by migration 007. Evaluated dates can be
-- recovered from the dated immutable report path. Other statuses require an
-- explicit status/date note; anything else deliberately remains unknown.
WITH recovered AS (
  SELECT event.id,
    CASE event.new_status
      WHEN 'Applied' THEN job.applied_at::date
      WHEN 'Evaluated' THEN coalesce(
        job.evaluated_at::date,
        ((regexp_match(job.report_path, '([0-9]{4}-[0-9]{2}-[0-9]{2})[.]md$'))[1])::date
      )
      WHEN 'Interview' THEN
        ((regexp_match(job.notes, '(?i)(?:^|[;,.][[:space:]]*)interview(?:ed)?[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1])::date
      WHEN 'Offer' THEN
        ((regexp_match(job.notes, '(?i)(?:^|[;,.][[:space:]]*)offer(?:ed)?[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1])::date
      WHEN 'Rejected' THEN
        ((regexp_match(job.notes, '(?i)(?:^|[;,.][[:space:]]*)rejected[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1])::date
      WHEN 'Ghosted' THEN
        ((regexp_match(job.notes, '(?i)(?:^|[;,.][[:space:]]*)ghosted[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1])::date
      WHEN 'Discarded' THEN
        ((regexp_match(job.notes, '(?i)(?:^|[;,.][[:space:]]*)discarded[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1])::date
    END AS status_date
  FROM job_status_events AS event
  JOIN jobs AS job ON job.id=event.job_id
  WHERE event.actor='migration' AND event.new_status=job.status
)
UPDATE job_status_events AS event
SET occurred_at = recovered.status_date::timestamp AT TIME ZONE 'America/Toronto'
FROM recovered
WHERE event.id=recovered.id AND recovered.status_date IS NOT NULL;

ALTER TABLE job_status_events ALTER COLUMN occurred_at SET DEFAULT now();
