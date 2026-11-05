# src/lib/_job-descriptions.mjs

**Kind:** shared module
**Purpose:** Keeps a cached JD file under `data/jds/` and the `job_descriptions` table in step. It reads a JD file safely (path confined to `data/jds/`), tags it with a `<!-- career-ops-job-id: N -->` marker so a renamed file can still be traced to its job, and pushes content plus SHA-256 hash to PostgreSQL through `sync_job_description`.

## Run
Not runnable; imported by other modules.

## Reads
- `data/jds/**/*.md` (the path passed in, resolved with `realpathSync` and required to stay inside `data/jds/`)
- PostgreSQL: `jobs` (existence check in `syncJD`), `job_descriptions` (`getJD`)

## Writes
- `data/jds/<file>`: rewritten once to append the job-ID marker when absent (`syncJD`)
- PostgreSQL: `sync_job_description(job_id, content, file_path, content_hash)` (`syncJD`), which upserts `job_descriptions` and updates `jobs.jd_path`

## Imports
- `src/lib/_database.mjs` (`root`, `query`)

## Used by
- `src/lib/_database.mjs` (dynamic import from `createJob`)
- `src/helpers/sync-jds.mjs` (`readJDFile`, `syncJD`, `jdJobID`)
- `src/helpers/test-database.mjs` (`withJobID`, `jdJobID`)
- `src/eval/evaluate-jobs.mjs`, `src/cvgen/_cv-drafting.mjs` (`getJD`)

## Notes
- Exports: `readJDFile(path, base=root)` returns `{content, file_path, content_hash}` with a forward-slash path relative to the root; throws on an empty file or a path outside `data/jds/`.
- `withJobID(content, id)` is idempotent and throws if the file already carries a different job ID ("JD belongs to #X, not #Y"); this is the guard against re-linking one file to two jobs.
- `jdJobID(content)` returns the marker's ID as a string or `null`.
- The SQL function only bumps `revision` when content or path actually changed, so repeated `syncJD` calls are idempotent (covered by `src/helpers/test-database.mjs`).
