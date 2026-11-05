ALTER TABLE jobs ADD COLUMN salary_min numeric;
ALTER TABLE jobs ADD COLUMN salary_max numeric;
ALTER TABLE jobs ADD CONSTRAINT jobs_salary_band_check CHECK (
  salary_min IS NULL OR salary_max IS NULL OR (salary_min >= 0 AND salary_max >= salary_min)
);
