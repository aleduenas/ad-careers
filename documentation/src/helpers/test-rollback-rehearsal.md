# src/helpers/test-rollback-rehearsal.mjs

**Authority:** `src/helpers/test-rollback-rehearsal.mjs`. Rehearses the additive-schema rollback
documented in [ROLLBACK.md](../../dashboard-migration/design/ROLLBACK.md).

Requires `TEST_DATABASE_URL` naming a `career_ops_test_` database (run it through
`node src/helpers/db-test.mjs`; without it the test prints SKIPPED). It creates a unique schema,
applies migrations 001 to 008 there, adds a synthetic job and status event, applies 009 and 010,
uses them (salary band, constraint, a queued then running browser run), then runs the rollback SQL
blocks that it extracts from ROLLBACK.md, so the documented procedure is the tested one. It checks
that the objects and `schema_migrations` rows are gone, that `jobs`, `job_status_events` and
`evaluations` are unchanged, then re-applies both migrations and checks that the objects are back,
empty and usable. The schema is dropped at the end. The personal database is never contacted.
