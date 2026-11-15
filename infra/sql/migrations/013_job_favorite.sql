-- One owner-set flag per job (D114): "low score, but I like it". It is a label only. It never
-- changes status, score, revision or job_status_events, and the SQL transition functions ignore it.
-- Additive. Rollback is a new migration that drops the index and the column.
ALTER TABLE jobs ADD COLUMN favorite boolean NOT NULL DEFAULT false;
CREATE INDEX jobs_favorite_idx ON jobs(id) WHERE favorite;
