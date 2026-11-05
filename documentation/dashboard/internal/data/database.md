# dashboard/internal/data/database.go

**Authority:** [dashboard/internal/data/database.go](../../../../dashboard/internal/data/database.go).

Provides PostgreSQL reads and revision-checked status transitions for the dashboard.

## Inputs

Reads root `.env`, with environment overrides and `DATABASE_URL` precedence; otherwise connects to local port 54329 using the configured password. Queries `jobs` and `job_descriptions` with five-second contexts.

## Outputs and behavior

Before loading rows, calls `ghost_stale_applications()` so Applied jobs more than 40 days past `applied_at` become Ghosted with a status event. Returns application models with the added/source date, the latest known occurrence date for the current status, and the latest discard reason, plus JD text. Added dates fall back to exact URL-matched scan history. Status dates come from `job_status_events.occurred_at`; unrecoverable legacy dates stay empty rather than using the PostgreSQL cutover timestamp. Status/discard operations call `change_job_status` with the expected revision and dashboard actor; database failures are errors. `UpdateJobField` writes one editable field (url, role, company, or the salary band) guarded by the value the dashboard loaded for that field, not the whole-row revision, so background status changes (evaluation, drafting, ghosting) cannot reject an unrelated edit; it strips control characters (PostgreSQL rejects NUL in text) and rejects an empty value, still bumps the revision, and reports a field changed elsewhere rather than updating nothing silently; `SyncEditedJD` stores an externally edited JD file verbatim through `sync_job_description` with its path and SHA-256 hash. Artifact/prep enrichment adds filesystem links to returned models.

`CheckURLTracked(root, rawURL)` supports the pasted-JD form's URL step. `urlKey` mirrors `src/lib/_database.mjs`'s normalization (scheme/`www.`, trailing punctuation, trailing slashes, lowercase) so results agree with `jobs.url_key` and with `add-pasted-jd.mjs`/`scan.mjs`'s own dedup. It first checks `jobs.url_key` for an exact match — a real duplicate, returned as `TrackedAsJob` with the existing job's number, company, role and status — then, only if that misses, checks `scan_history` (whose URLs aren't pre-normalized, so the match re-derives the key with `regexp_replace` in SQL) for a past sighting that never became a job, returned as `SeenInScan` with that row's company, title, status and first-seen date.

## Dependencies and callers

Imports `database/sql`, the pgx stdlib driver, internal model types and Go configuration/context utilities. Called by `main.go`; enrichment functions live in `career.go`. No fallback file tracker.
