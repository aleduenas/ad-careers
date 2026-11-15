-- Rollback of migration 010 (additive schema only). Rehearsed by
-- src/helpers/test-rollback-rehearsal.mjs in the isolated test database. Take a backup first;
-- see infra/README.md.
BEGIN;
DROP FUNCTION interrupt_stale_browser_runs(timestamptz, integer[]);
DROP FUNCTION finish_browser_run(uuid, text, integer, text);
DROP FUNCTION report_browser_run(uuid, text, integer);
DROP FUNCTION start_browser_run(uuid, integer, timestamptz);
DROP TABLE browser_runs;
DELETE FROM schema_migrations WHERE name = '010_browser_runs.sql';
COMMIT;
