# src/scan/add-pasted-jd.mjs

**Kind:** launcher
**Purpose:** Manual JD intake for the dashboard. Reads a JSON payload `{url, company, role, text, force}` from stdin, validates it, canonicalizes the company spelling against names already in PostgreSQL, saves the pasted description byte-for-byte under `data/jds/`, creates a Pending job through `create_job`, and records the intake in `scan_history`. Exports `canonicalCompany` and `rawJDDocument` for tests.

## Run
`echo '{"url":"...","company":"...","role":"...","text":"...","force":false}' | node src/scan/add-pasted-jd.mjs`
- No flags. Input is JSON on stdin; output is one line `Added #<id> — <company> — <role> (...)` on success, or an error message and exit code 1.
- Validation: URL is normalized (control characters and wrapping quotes/brackets stripped, `https://` prepended when no scheme) and must be http(s); company and role are required; trimmed text must be at least 100 characters.
- Dedup: the dashboard's paste form checks PostgreSQL itself before this script ever runs (`dashboard/internal/data/database.go`'s `CheckURLTracked`) and lets the user confirm past a `scan_history`-only sighting, so this script's own check is a safety net for direct/CLI invocation. A URL already in `jobs` (matched by `url_key`) always fails, since `createJob` would otherwise silently resync that job's JD onto a new paste — this is never bypassable. A URL only seen in `scan_history` (`loadSeenUrls`) fails unless `force` is true.
- `main()` only runs when invoked directly.

## Reads
- stdin JSON payload.
- PostgreSQL: `jobs.company`, `scan_history.company` (distinct trimmed names for `canonicalCompany`); `jobs.url_key` (exact-duplicate check); `jobs.url`, `scan_history.url` (via `loadSeenUrls`, honored unless `force`). Connection through `src/lib/_database.mjs` (`.env` / `DATABASE_URL`).
- Existing `data/jds/<company>/<role>.md` frontmatter (via `jdStoragePath`) to avoid path collisions.

## Writes
- `data/jds/<company-slug>/<role-slug>.md` with frontmatter `company, role, url, source: manual-paste, fetched` followed by the untouched body. Skipped if the file already exists.
- PostgreSQL: `create_job(...)` and `sync_job_description(...)` via `createJob` (which also appends the job-id marker to the JD file); `INSERT INTO scan_history` with status `added` and portal `manual-paste`.

## Imports
- `../lib/_database.mjs` (`createJob`, `query`, `urlKey`), `../lib/root.mjs` (`root`), `./scan.mjs` (`slugify`, `jdStoragePath`, `loadSeenUrls`, `appendToScanHistory`).

## Used by
- `dashboard/workflow.go` `runJDSubmit` (JD submit action): marshals the intake fields (including `force`) to JSON, pipes them on stdin, logs stdout+stderr to `logs/dashboard/paste-jd-*.log`. The dashboard's own `checkJDURL`/`CheckURLTracked` runs first, at the paste form's URL step, so `force` is normally only ever true after the user has confirmed a `scan_history`-only match.
- `src/scan/test-pasted-jd.mjs` (imports `rawJDDocument`).

## Notes
- URL normalization adds HTTPS when absent, strips pasted wrappers/control characters and validates an HTTP(S) URL with a hostname before database access.
- Company canonicalization only replaces the entered spelling when exactly one existing name matches after lowercasing and stripping non-alphanumerics (so `TD` never becomes `TD Bank`).
- The body is retained verbatim; only its trimmed length is inspected. No title, location or gate filtering is applied to pasted JDs (the user supplied it, so it is treated as live and wanted).
- Importing `./scan.mjs` triggers that module's `mkdirSync('data')` side effect.
