-- Durable records for work launched from the browser dashboard. Run states are
-- their own vocabulary and never touch jobs.status. Nothing here writes to
-- jobs, evaluations, job_status_events or job_descriptions.
CREATE TABLE browser_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 200),
  group_id uuid,
  action text NOT NULL CHECK (action IN ('evaluate','cv','letter','scan','intake','publish')),
  job_id bigint REFERENCES jobs(id),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','interrupted')),
  phase text NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  pid integer,
  pid_started_at timestamptz,
  exit_code integer,
  error_code text,
  log_ref text NOT NULL CHECK (log_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' AND log_ref NOT LIKE '%..%'),
  selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((state IN ('completed','failed','interrupted')) = (finished_at IS NOT NULL)),
  CHECK (state = 'queued' OR started_at IS NOT NULL OR state IN ('failed','interrupted'))
);
CREATE INDEX browser_runs_active_idx ON browser_runs (created_at) WHERE state IN ('queued','running');
CREATE INDEX browser_runs_job_idx ON browser_runs (job_id, created_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX browser_runs_recent_idx ON browser_runs (created_at DESC);
CREATE INDEX browser_runs_group_idx ON browser_runs (group_id) WHERE group_id IS NOT NULL;

-- queued -> running, once. Any other state is a no-op that returns the row.
CREATE FUNCTION start_browser_run(p_id uuid,p_pid integer,p_pid_started_at timestamptz)
RETURNS browser_runs LANGUAGE plpgsql AS $$
DECLARE result browser_runs;
BEGIN
  SELECT * INTO result FROM browser_runs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown browser run %',p_id; END IF;
  IF result.state<>'queued' THEN RETURN result; END IF;
  UPDATE browser_runs SET state='running',phase='running',pid=p_pid,pid_started_at=p_pid_started_at,
    started_at=now(),updated_at=now() WHERE id=p_id RETURNING * INTO result;
  RETURN result;
END $$;

-- Progress for running rows only. Attempts never decrease; a lower attempt is ignored.
CREATE FUNCTION report_browser_run(p_id uuid,p_phase text,p_attempt integer)
RETURNS browser_runs LANGUAGE plpgsql AS $$
DECLARE result browser_runs;
BEGIN
  IF p_phase IS NULL OR length(p_phase)<1 OR length(p_phase)>80 THEN RAISE EXCEPTION 'Invalid run phase'; END IF;
  IF p_attempt IS NULL OR p_attempt<1 THEN RAISE EXCEPTION 'Invalid run attempt'; END IF;
  SELECT * INTO result FROM browser_runs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown browser run %',p_id; END IF;
  IF result.state<>'running' OR p_attempt<result.attempt THEN RETURN result; END IF;
  UPDATE browser_runs SET phase=p_phase,attempt=p_attempt,updated_at=now()
    WHERE id=p_id RETURNING * INTO result;
  RETURN result;
END $$;

-- queued|running -> completed|failed|interrupted, once. A terminal row is returned unchanged.
CREATE FUNCTION finish_browser_run(p_id uuid,p_state text,p_exit_code integer,p_error_code text)
RETURNS browser_runs LANGUAGE plpgsql AS $$
DECLARE result browser_runs;
BEGIN
  IF p_state NOT IN ('completed','failed','interrupted') THEN RAISE EXCEPTION 'Invalid terminal run state'; END IF;
  SELECT * INTO result FROM browser_runs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown browser run %',p_id; END IF;
  IF result.state NOT IN ('queued','running') THEN RETURN result; END IF;
  UPDATE browser_runs SET state=p_state,exit_code=p_exit_code,error_code=p_error_code,
    finished_at=now(),updated_at=now() WHERE id=p_id RETURNING * INTO result;
  RETURN result;
END $$;

-- Marks only running rows: pids the server proved dead, or rows started more than 24 hours
-- before p_now. Terminal and queued rows are never touched. Returns the rows it changed.
CREATE FUNCTION interrupt_stale_browser_runs(p_now timestamptz,p_dead_pids integer[])
RETURNS SETOF browser_runs LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY UPDATE browser_runs SET state='interrupted',
      error_code=CASE WHEN pid=ANY(coalesce(p_dead_pids,ARRAY[]::integer[])) THEN 'PROCESS_GONE' ELSE 'STALE_24H' END,
      finished_at=now(),updated_at=now()
    WHERE state='running'
      AND (pid=ANY(coalesce(p_dead_pids,ARRAY[]::integer[])) OR started_at<p_now-interval '24 hours')
    RETURNING *;
END $$;
