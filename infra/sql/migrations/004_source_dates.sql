-- Every newly ingested job receives the date it was sourced. Keep the
-- original five-argument function for older callers and imports, which may
-- legitimately have an unknown historical source date.
CREATE FUNCTION create_job(p_company text,p_role text,p_url text,p_key text,p_jd text,p_source_date date)
RETURNS jobs LANGUAGE plpgsql AS $$
DECLARE result jobs;
BEGIN
  INSERT INTO jobs(company,role,url,url_key,jd_path,source_date,created_at)
  VALUES(p_company,p_role,p_url,p_key,p_jd,p_source_date,now())
  ON CONFLICT(url_key) DO NOTHING RETURNING * INTO result;
  IF result.id IS NULL THEN SELECT * INTO result FROM jobs WHERE url_key=p_key; END IF;
  RETURN result;
END $$;

-- The manual-paste JD is the authoritative record of its ingestion date.
-- Backfill only those records; unknown legacy source dates remain null.
UPDATE jobs AS job
SET source_date = (regexp_match(description.content, '(?m)^fetched:\s*(\d{4}-\d{2}-\d{2})\s*$'))[1]::date
FROM job_descriptions AS description
WHERE description.job_id = job.id
  AND job.source_date IS NULL
  AND description.content ~ '(?m)^source:\s*manual-paste\s*$'
  AND description.content ~ '(?m)^fetched:\s*\d{4}-\d{2}-\d{2}\s*$';
