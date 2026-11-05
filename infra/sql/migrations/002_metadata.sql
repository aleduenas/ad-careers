CREATE FUNCTION update_job_metadata(p_id bigint,p_revision bigint,p_role text,p_note text)
RETURNS jobs LANGUAGE plpgsql AS $$
DECLARE result jobs;
BEGIN
  SELECT * INTO result FROM jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown job %',p_id; END IF;
  IF result.revision<>p_revision THEN RAISE EXCEPTION 'Revision conflict for job %; refresh and retry',p_id USING ERRCODE='40001'; END IF;
  IF p_role IS NOT NULL AND length(trim(p_role))=0 THEN RAISE EXCEPTION 'Role must not be empty'; END IF;
  UPDATE jobs SET role=coalesce(p_role,role),
    notes=concat_ws(E'\n',nullif(notes,''),nullif(p_note,'')),
    revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO result;
  RETURN result;
END $$;
