# src/helpers/verify-pipeline.mjs

**Kind:** admin command
**Purpose:** Checks that every file path stored in the database still exists on disk: for each job, `report_path` and `jd_path` (when set) are resolved against the repository root. It is the quick consistency check to run after moving or pruning files.

## Run
`node src/helpers/verify-pipeline.mjs` (alias `npm run verify`). No flags. Prints `{jobs, missing_artifacts: [...]}` as JSON and exits 1 if anything is missing.

## Reads
- PostgreSQL: `jobs.id`, `jobs.status`, `jobs.report_path`, `jobs.jd_path`
- Existence of each referenced file under the repository root

## Writes
- none

## Imports
- `src/lib/_database.mjs` (`query`, `close`, `root`)

## Used by
- `package.json` script `verify`
- `src/helpers/db-cutover.mjs` (step 8)
- `src/test-all.mjs` lists it as a required system file (existence only; it is not executed by the suite)

## Notes
- Paths in the database are relative to the repository root (layout rule 6); a row whose path still uses a pre-layout prefix such as `reports/` will be reported as missing until the pending DB path rewrite is done.
- `status` is selected but not used in the output.
