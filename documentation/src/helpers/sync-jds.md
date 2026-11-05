# src/helpers/sync-jds.mjs

**Kind:** admin command
**Purpose:** Audits or synchronises the cached JD files under `data/jds/` into the `job_descriptions` table for every job (or one job). In audit mode it only checks that each linked file is readable; with `--apply` it tags each file with its job ID and upserts content plus hash through `syncJD`. Run it after intentionally editing a cached JD file.

## Run
`node src/helpers/sync-jds.mjs [--apply] [--job=ID] [--file=PATH]`
- default: audit; prints `{mode, readable, without_link, errors}` and exits 1 if any errors
- `--apply`: write to PostgreSQL (mode `sync`)
- `--job=ID`: restrict to one job
- `--file=PATH`: use this file (relative to the root, inside `data/jds/`) for that job; requires `--job`

## Reads
- PostgreSQL: `jobs.id`, `jobs.jd_path`
- `data/jds/**/*.md`: the linked file, or every file (searching for the `<!-- career-ops-job-id: N -->` marker) when the linked path no longer exists

## Writes
- `data/jds/<file>`: job-ID marker appended if missing (`--apply`)
- PostgreSQL: `sync_job_description(...)` via `syncJD`, which also updates `jobs.jd_path` when the path changed (`--apply`)

## Imports
- `src/lib/_database.mjs` (`query`, `close`, `root`)
- `src/lib/_job-descriptions.mjs` (`readJDFile`, `syncJD`, `jdJobID`)

## Used by
- `src/helpers/db-cutover.mjs` (`--apply`, step 7)
- Named in the error message of `src/cvgen/_cv-drafting.mjs` when a job has no database JD

## Notes
- Jobs with `jd_path = NULL` are counted as `without_link` and skipped unless `--file` is given.
- A renamed file is found only through its ID marker; if two files claim the same ID the job is reported as an error ("Multiple JD files claim job #N").
- Per-job failures are collected rather than aborting the run, so one bad file does not block the rest.
