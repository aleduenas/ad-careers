-- Rollback of migration 009 (additive schema only). Rehearsed by
-- src/helpers/test-rollback-rehearsal.mjs in the isolated test database. Take a backup first;
-- see infra/README.md.
BEGIN;
ALTER TABLE jobs DROP CONSTRAINT jobs_salary_band_check;
ALTER TABLE jobs DROP COLUMN salary_min;
ALTER TABLE jobs DROP COLUMN salary_max;
DELETE FROM schema_migrations WHERE name = '009_salary_band.sql';
COMMIT;
