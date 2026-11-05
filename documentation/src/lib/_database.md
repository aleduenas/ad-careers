# src/lib/_database.mjs

**Kind:** shared module
**Purpose:** The single PostgreSQL access layer for every backend script. It resolves connection settings from `.env` or the environment, holds one lazily created `pg.Pool`, and exposes `query`, `transaction`, `createJob`, `getJob`, `urlKey` and `close`. Job creation goes through the `create_job` SQL function so ID allocation and URL deduplication happen in the database.

## Run
Not runnable; imported by other modules.

## Reads
- `.env` at the repository root (lines matching `UPPER_CASE=value`); `process.env` values override it
- Environment: `DATABASE_URL` (used verbatim if set), otherwise `POSTGRES_PASSWORD` (required) and `POSTGRES_PORT` (default 54329); host `127.0.0.1`, database and user `career_ops`
- PostgreSQL: `jobs` (`getJob`), and whatever callers pass to `query`
- `data/jds/<path>` when `createJob` receives a `jd_path` (through `readJDFile`)

## Writes
- PostgreSQL: `create_job(company, role, url, url_key, jd_path, source_date::date)` and `sync_job_description(...)` inside one transaction when `createJob` is called; then an idempotent `syncJD` after commit (the transaction already stores ID-tagged content and its hash, so the new JD remains at revision 1)
- `data/jds/<path>`: the job-ID marker comment is appended by the post-commit `syncJD` call

## Imports
- `src/lib/root.mjs` (re-exported as `root`)
- `src/lib/_job-descriptions.mjs` (dynamic import inside `createJob`, to avoid a static import cycle)

## Used by
- Nearly every script: `src/scan/scan.mjs`, `src/scan/add-pasted-jd.mjs`, `src/eval/evaluate-jobs.mjs`, `src/eval/next-jobs.mjs`, `src/cvgen/_cv-drafting.mjs`, `src/analytics/*.mjs`
- `src/lib/_job-descriptions.mjs`, `src/lib/_job-workflows.mjs`
- All of `src/helpers/` except `prune-logs.mjs` and `verify-portals.mjs`
- `src/test-all.mjs` lists it as a required system file

## Notes
- Pool settings: 5 s connection timeout, 15 s statement timeout, `allowExitOnIdle` so scripts exit without calling `close()`; scripts still call `close()` in `finally` for promptness.
- `transaction(fn)` runs `BEGIN`/`COMMIT` and `ROLLBACK` on any throw; `fn` receives the raw client.
- `urlKey` strips scheme, `www.`, trailing punctuation and slashes and lower-cases; it is the dedup key stored in `jobs.url_key`.
- `createJob` validates `source_date` as `YYYY-MM-DD` and defaults it to today.
