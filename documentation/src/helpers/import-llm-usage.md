# src/helpers/import-llm-usage.mjs

**Kind:** helper (dry-run by default)
**Purpose:** Backfill `llm_calls` from existing launcher logs so the Cost page has history.

## Run
```
node src/helpers/import-llm-usage.mjs            # dry run: JSON counts by provider and function
node src/helpers/import-llm-usage.mjs --apply    # insert the rows
```
The dry run only reads files and runs two read-only SELECTs (known job ids, already-recorded `log_ref` values). If the table does not exist yet it says so and counts every file. `--apply` needs migration 011 applied. Run `--apply` only against the intended database.

The dry run reports `wouldRepairJob`: rows already recorded with no `job_id` whose log path yields a job that exists. `--apply` sets only that `job_id` (`UPDATE ... WHERE log_ref = ? AND job_id IS NULL`); a job id that is already set is never overwritten and nothing else on the row changes. Repair needs a `log_ref`, so live rows without one (drafting) cannot be repaired.

## Reads
- `logs/evaluation/**/*.stdout.log` and `logs/drafting/runs/**/*-usage.json`; the run's `run.json` for a fallback provider.

## Writes
- `llm_calls` rows with `source = 'backfill'` and `log_ref` = repository-relative log path. Idempotent: reruns insert nothing. Never touches `jobs` or any other table.

## Derivation
- Evaluation logs are `<phase>-<epoch ms>-<attempt>.stdout.log`. Phase maps to `gate`, `market`, `evaluation`, `companyResearch` (from `research`) or `smoke`; any other phase is skipped and counted.
- Provider is detected from the output shape (Claude JSON object or Codex events); an unparsable file falls back to the run's provider and is stored as a `usage_missing` row.
- Job id is the numeric folder the log sits in, and only when that job exists; company research has none. Run id is not recorded (old run folders are not UUIDs).
- Timestamp is the epoch in the file name, else the file time; drafting runs use the run folder's timestamp. Drafting runs are `coverLetter` when the folder name contains `-letter-`, else `cv`; their job is unknown.
- Model: `parseUsage` returns the Claude model with the most output tokens (requested alias is not known, so `requested_model` is null); Codex logs and run records do not name the model, so it is `unknown`.
- History reaches only as far as the logs still exist.

## Exports (for tests)
`planBackfill(root, { knownJobs })`, `summarize(rows)`, `applyBackfill(rows, { query })`, `planRepairs(rows, existing)`, `applyRepairs(repairs, { query })`.

## Used by
- `src/lib/test-llm-usage-database.mjs`; listed in `documentation/guides/SCRIPTS.md`.
