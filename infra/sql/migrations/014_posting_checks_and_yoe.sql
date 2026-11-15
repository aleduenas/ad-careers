-- Posting liveness checks (D117) and the years-of-experience estimate (D116). Additive.
-- posting_checks holds one row per check of a saved posting. The "flagged" state of a job is
-- derived from its latest check, never stored on jobs. A check never changes jobs by itself: the
-- only status change is Discarded through change_job_status (reason "Posting expired", actor
-- "liveness-check"), and that call is made by the server, not by this table.
CREATE TABLE posting_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('open','closed','probably_closed','unknown')),
  method text NOT NULL,
  detail text NOT NULL DEFAULT '',
  action text NOT NULL CHECK (action IN ('none','flagged','discarded','held_back')),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posting_checks_job_checked ON posting_checks(job_id, checked_at DESC, id DESC);

-- browser_runs gains the 'liveness' action. 010 created the CHECK without a name.
ALTER TABLE browser_runs DROP CONSTRAINT browser_runs_action_check;
ALTER TABLE browser_runs ADD CONSTRAINT browser_runs_action_check
  CHECK (action IN ('evaluate','cv','letter','scan','intake','publish','liveness'));

-- D116: lowest years of experience the posting asks for, with how it was found. Both nullable:
-- no estimate is NULL, never a guess.
ALTER TABLE job_descriptions ADD COLUMN yoe_min integer CHECK (yoe_min BETWEEN 0 AND 40);
ALTER TABLE job_descriptions ADD COLUMN yoe_confidence text
  CHECK (yoe_confidence IN ('high','medium','low','inferred'));
