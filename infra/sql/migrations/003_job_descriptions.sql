CREATE TABLE job_descriptions (
  job_id bigint PRIMARY KEY REFERENCES jobs(id),
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  file_path text NOT NULL,
  content_hash text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION sync_job_description(p_id bigint,p_content text,p_path text,p_hash text)
RETURNS job_descriptions LANGUAGE plpgsql AS $$
DECLARE result job_descriptions;
BEGIN
  PERFORM 1 FROM jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown job %',p_id; END IF;
  INSERT INTO job_descriptions(job_id,content,file_path,content_hash)
  VALUES(p_id,p_content,p_path,p_hash)
  ON CONFLICT(job_id) DO UPDATE SET content=excluded.content,file_path=excluded.file_path,
    content_hash=excluded.content_hash,revision=job_descriptions.revision+1,synced_at=now()
  WHERE job_descriptions.content IS DISTINCT FROM excluded.content
     OR job_descriptions.file_path IS DISTINCT FROM excluded.file_path;
  UPDATE jobs SET jd_path=p_path WHERE id=p_id AND jd_path IS DISTINCT FROM p_path;
  SELECT * INTO result FROM job_descriptions WHERE job_id=p_id;
  RETURN result;
END $$;
