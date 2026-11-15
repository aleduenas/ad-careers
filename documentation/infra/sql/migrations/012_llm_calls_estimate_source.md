# 012_llm_calls_estimate_source.sql

**Authority:** `infra/sql/migrations/012_llm_calls_estimate_source.sql` and
`documentation/dashboard-migration/packages/4.7-cost.md` (D093).

Additive migration that widens the `llm_calls.source` CHECK from `live`, `backfill` to `live`,
`backfill`, `estimate`. Migration 011 is immutable, so the unnamed check it created
(`llm_calls_source_check`) is dropped and recreated with the third value. No data changes and no
other table is touched.

`estimate` marks a row produced by `node src/helpers/import-llm-usage.mjs --estimate-drafting`
for a past CV or cover-letter run that kept no usage. Its token counts come from saved prompt and
response sizes and call durations (see `documentation/src/lib/_llm-estimate.md`), never from a
provider. Readers can include or exclude these rows (`estimates: 'include' | 'exclude'`).

## Rollback (non-destructive)

Rollback is a new migration, never an edit. First remove the estimated rows or keep them under
a different label: `pg_dump -t llm_calls` for evidence, then `DELETE FROM llm_calls WHERE
source = 'estimate'` (they carry no information the logs cannot regenerate), then a numbered
migration that restores the two-value CHECK. Skipping the restore is harmless: the wider CHECK
accepts everything the old one did. Launcher code never writes `estimate`. Apply to the personal
database only through the documented migration command.
