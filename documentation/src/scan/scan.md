# src/scan/scan.mjs

**Kind:** launcher
**Purpose:** Zero-token portal scanner. Loads every provider under `src/scan/providers/`, resolves one provider per enabled `tracked_companies` entry in `config/portals.yml`, fetches postings over plain HTTP, applies title/location/dedup filters, caches each full JD under `data/jds/`, runs the location gate, and creates Pending jobs in PostgreSQL. Also exports the helpers (`slugify`, `jdStoragePath`, `saveJd`, `loadProviders`, `resolveProvider`, `buildTitleFilter`, `buildLocationFilter`, `loadSeenUrls`, `loadSeenCompanyRoles`, `appendToPipeline`, `appendToScanHistory`) that `add-pasted-jd.mjs` and `verify-portals.mjs` reuse.

## Run
`node src/scan/scan.mjs [--dry-run] [--company <name> | --company=<name>] [--report-json <path> | --report-json=<path>]`
- `--dry-run`: discover and filter, print the summary, but write no JD files, no PostgreSQL rows and no provider caches (`ctx.dryRun = true`). Only a requested coverage report is still written.
- `--company X`: case-insensitive substring match on the entry `name`; only matching entries are scanned.
- `--report-json <path>`: write a coverage report (`schema_version: 1`, per-company classification/provider/status/jobs_found/reason, enabled `search_queries`). Parent directory is created.
- `main()` only runs when the file is the entry script, so importing it is side-effect free apart from `mkdirSync('data')`.
- Alias: `npm run scan`. Concurrency across companies is fixed at 10.

## Reads
- `config/portals.yml`: `tracked_companies[]` (`name`, `enabled`, `provider`, `careers_url`, `scan_class`, `scan_method`, `scan_query`, per-entry `title_filter_positive`, plus provider-specific keys), `title_filter.positive/negative`, `location_filter.allow/block`, `search_queries` (report only).
- Provider modules: every `src/scan/providers/*.mjs` not prefixed `_`, alphabetical.
- Existing `data/jds/<company>/<role>.md` (frontmatter `url:` line) to decide the storage path.
- PostgreSQL: `jobs.url`, `scan_history.url` (seen URLs), `jobs.company/role` and `scan_history.company/title WHERE status='added'` (seen company-role pairs). Env: `.env`/`DATABASE_URL`/`POSTGRES_*` through `src/lib/_database.mjs`.
- Network: only what each provider fetches.

## Writes
- `data/jds/<company-slug>/<role-slug>.md` (or `<role-slug>-<16 hex of url key>.md` when the base file belongs to a different URL). Content already starting with `---` is written verbatim; otherwise `htmlToText` plus generated frontmatter (`company, role, url, source, location, fetched`). Never overwrites an existing file.
- PostgreSQL: `create_job(...)` and `sync_job_description(...)` via `createJob` (which also appends a `<!-- career-ops-job-id: N -->` marker to the JD file); `INSERT INTO scan_history` with status `added`, `skipped_title`, `skipped_location` or `location-fail`.
- `--report-json` file; `data/` directory created on import.

## Imports
- `./providers/_http.mjs` (`makeHttpCtx`, `htmlToText`), `./location-gate-core.mjs` (`gate`), `../lib/_database.mjs` (`query`, `createJob`, `urlKey`), `js-yaml`.

## Used by
- `dashboard/main.go` scan action (`PipelineRunScanMsg` runs `node src/scan/scan.mjs` in the repo root).
- `src/scan/add-pasted-jd.mjs` (imports `slugify`, `jdStoragePath`, `loadSeenUrls`, `appendToScanHistory`).
- `src/helpers/verify-portals.mjs` (imports `loadProviders`, `resolveProvider`).
- `src/scan/test-scan-coverage.mjs`; `package.json` `scan` script; listed as a required system file in `src/test-all.mjs`.

## Notes
- Provider resolution: explicit `provider:` wins (unknown id is an error row); otherwise each provider's `detect(entry)` runs in alphabetical file order and the first hit wins. Entries with no match are `rich-only` when `scan_class: rich-only` or `scan_method: websearch|rich`, else `unclassified` (reported as an error).
- Title filter: positive keywords are case-insensitive substrings (empty list passes all); negative alphanumeric keywords use word-boundary matching so `Lead, X` is caught; punctuated keywords use plain substring. Per-entry `title_filter_positive` extends the global positives but keeps the global negatives.
- Location filter: empty location passes; `block` beats `allow`; empty `allow` passes.
- Dedup: URL comparison uses `urlKey` (scheme, `www.`, trailing punctuation and slashes stripped, lowercased); company-role key is `company::title` lowercased. Both sets are also updated within the run so intra-scan duplicates are skipped.
- `ctx.shouldFetchContent(job)` is handed to providers so they only spend JD requests on jobs that would survive title, location, URL and company-role filters.
- Any job whose text is under 300 characters after `htmlToText` is counted as `Missing full JD` and deferred: not cached, not inserted, not marked seen.
- Order per job: filter -> dedup -> content check -> mark seen -> `saveJd` -> `gate()`. A gate FAIL still leaves the cached JD file on disk and records `location-fail` in `scan_history` (no job row).
- Observation: providers set `contentRequired: true` on their jobs, but `scan.mjs` never reads that flag; the 300-character minimum is applied uniformly to every provider.
- Observation: the usage comment mentions `logs/scan/coverage.json`; nothing in the repo enforces that path.
