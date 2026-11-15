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

## Estimating past drafting (D093)
`node src/helpers/import-llm-usage.mjs --estimate-drafting [--apply]` estimates CV and cover-letter runs under `logs/drafting/runs/` that kept no usage and stores one `source = 'estimate'` row per call (needs migration 012 for `--apply`). Dry run is the default and prints the calibration constants, calls to estimate, skipped runs, assumptions, counts and token totals by month, function and provider, and a plain-ratio comparison (thinking = 0.58 times visible). Method, constants and skip rules are in `documentation/src/lib/_llm-estimate.md`. It reads the table only to find measured rows, the model timeline and job URLs; `--since=YYYY-MM-DD` (default `2026-11-06`, the CV drafter fix) sets the storage cutoff: the report has a `stored` section and a `notStoredBeforeCutoff` section with the same breakdown, and `--apply` inserts only runs whose folder date is on or after the cutoff; earlier runs are never inserted, whatever the flags. Insert is idempotent on `log_ref` (the response file).

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
