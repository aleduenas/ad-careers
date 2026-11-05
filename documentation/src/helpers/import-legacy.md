# src/helpers/import-legacy.mjs

**Kind:** admin command
**Purpose:** The one-time audited importer of the retired markdown trackers (`data/pipeline.md`, `data/applications.md`, `data/id-counter`, `data/scan-history.tsv`) into PostgreSQL. `audit()` parses the files into job records, reconciles pipeline and tracker entries, links cached JDs, deduplicates by URL and produces a content fingerprint; `importRecords()` inserts everything in one transaction with parity checks. Operational code must not import this module.

## Run
- `node src/helpers/import-legacy.mjs` (alias `npm run db:audit`): print the audit as JSON; exit 1 if it has errors, nothing written
- `--apply`: back the source files up to `data/archive/postgres-import-<fingerprint12>/`, then import
- `--apply --archive`: after importing, re-audit; if the fingerprint is unchanged, rename the source files and `batch/` leftovers into the backup folder with a `retired-` prefix

## Reads
- `data/pipeline.md`, `data/applications.md`, `data/id-counter`, `data/scan-history.tsv`
- `config/database-import.json` (approved ID-conflict resolutions, `id_conflicts` map)
- Report files linked from the tracker (URL line `**URL:** ...`), `data/jds/**` via `findCachedJD`, `batch/tracker-additions/*.tsv` (must be empty)
- PostgreSQL: `legacy_imports`, `jobs` count, and each inserted `jobs` row for parity

## Writes
- `data/archive/postgres-import-*/` copies and, with `--archive`, renamed originals plus `batch/tracker-additions`, `batch/batch-manifest.json`, `batch/.finalize.lock`
- PostgreSQL: `jobs`, `job_status_events` (actor `migration`, with `occurred_at` left null because cutover time is not transition time), `evaluations` (key `legacy:<fingerprint>:<id>`), `scan_history`, `legacy_imports`; resets the `jobs.id` sequence to the last allocated ID

## Imports
- `src/lib/_database.mjs` (`root`, `urlKey`, `transaction`, `close`)
- `src/lib/_cached-jd.mjs` (`findCachedJD`)

## Used by
- `package.json` script `db:audit`
- `src/helpers/db-cutover.mjs` (three invocations, skipped when no source files exist)
- `src/helpers/test-database.mjs` (`importRecords`), `src/helpers/test-legacy-import.mjs` (`audit`)

## Notes
- `importRecords` takes `pg_advisory_xact_lock(71938201)`, returns silently if the fingerprint was already imported, and otherwise requires an empty `jobs` table. A parity failure or history-count mismatch throws, rolling back the whole import.
- Tracker rows take precedence over pipeline rows for the same ID; a URL conflict is an error unless `config/database-import.json` approves `preserve_tracker_id_reassign_pipeline`, in which case the pipeline record gets a new ID.
- Legacy `SKIP` rows import as `Discarded`. For an Applied row, an exact `Applied YYYY-MM-DD` prefix preserved in its notes becomes `applied_at`; otherwise the historical application date remains null. Duplicate URLs keep the more advanced status (`Pending < Evaluated < Discarded < Applied < Ghosted < Interview < Rejected < Offer`), then the higher ID.
- The `main()` guard compares `process.argv[1]` to `src/helpers/import-legacy.mjs`, so importing the module from tests runs nothing.
- Observation: report links in the tracker are resolved relative to `data/` (`resolve(base,'data',link)`), matching the pre-layout `../reports/NNN.md` form; migration 005 has already rewritten live database paths. These historical input links still describe the retired source format.
