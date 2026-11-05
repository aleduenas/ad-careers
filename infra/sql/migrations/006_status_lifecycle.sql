-- Merge the legacy SKIP status into Discarded and add automatic ghosting.
UPDATE jobs SET status = 'Discarded' WHERE status = 'SKIP';
UPDATE evaluations SET result_status = 'Discarded' WHERE result_status = 'SKIP';
UPDATE job_status_events SET old_status = 'Discarded' WHERE old_status = 'SKIP';
UPDATE job_status_events SET new_status = 'Discarded' WHERE new_status = 'SKIP';

ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('Pending','Evaluated','Applied','Interview','Offer','Rejected','Discarded','Ghosted'));

ALTER TABLE evaluations DROP CONSTRAINT evaluations_result_status_check;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_result_status_check
  CHECK (result_status IN ('Evaluated','Discarded'));

-- Preserve the actual application transition date where historical status
-- events can fill a missing applied_at value.
UPDATE jobs AS job
SET applied_at = event.first_applied_at
FROM (
  SELECT job_id, min(created_at) AS first_applied_at
  FROM job_status_events
  WHERE new_status = 'Applied'
  GROUP BY job_id
) AS event
WHERE job.id = event.job_id AND job.applied_at IS NULL;

CREATE OR REPLACE FUNCTION change_job_status(p_id bigint,p_revision bigint,p_status text,p_reason text,p_actor text)
RETURNS jobs LANGUAGE plpgsql AS $$
DECLARE result jobs; previous text;
BEGIN
  SELECT * INTO result FROM jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job % does not exist',p_id; END IF;
  IF result.revision<>p_revision THEN RAISE EXCEPTION 'Revision conflict for job %; refresh and retry',p_id USING ERRCODE='40001'; END IF;
  IF p_status='Discarded' AND length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Discard reason is required'; END IF;
  previous:=result.status;
  UPDATE jobs SET status=p_status,revision=revision+1,updated_at=now(),
    applied_at=CASE WHEN p_status='Applied' AND previous<>'Applied' THEN now() ELSE applied_at END,
    notes=CASE WHEN p_reason='' THEN notes ELSE concat_ws(E'\n',nullif(notes,''),p_reason) END
    WHERE id=p_id RETURNING * INTO result;
  INSERT INTO job_status_events(job_id,old_status,new_status,reason,actor) VALUES(p_id,previous,p_status,p_reason,p_actor);
  RETURN result;
END $$;

CREATE FUNCTION ghost_stale_applications()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE moved_count integer;
BEGIN
  WITH moved AS (
    UPDATE jobs
    SET status='Ghosted',revision=revision+1,updated_at=now()
    WHERE status='Applied' AND applied_at < now()-interval '40 days'
    RETURNING id
  )
  INSERT INTO job_status_events(job_id,old_status,new_status,reason,actor)
  SELECT id,'Applied','Ghosted','No response 40 days after application','dashboard-auto'
  FROM moved;
  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END $$;
