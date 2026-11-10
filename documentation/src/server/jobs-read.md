# src/server/jobs-read.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE2_READ_CONTRACT.md` and the Go
`dashboard/internal/data/database.go` `LoadApplications` SELECT it reuses (without the
`ghost_stale_applications()` call, which is a Stage 3.2 write).

Read-only data layer for `GET /api/v1/jobs` and `GET /api/v1/overview`.

- `normalizeJobsQuery(raw)` validates `q`, `filter`, `sort`, `direction`, `grouped`, `limit` and
  the opaque `cursor` strictly (closed enums, bounded lengths, no coercion) and throws a 400
  `INVALID_REQUEST` error naming the offending field.
- `createJobsReader({query, resolveMaterials, readCompensation, cursorKey, rootDir})` returns
  `{list, overview}`. Every transport is injectable so tests never need PostgreSQL; the defaults
  are the `src/lib/_database.mjs` `query`, `jobs-materials.mjs` and `jobs-compensation.mjs`.
- `list` runs one SELECT (`jobsReadSql`), filters in memory (`all` is non-Pending, `top` is score
  >= 4 excluding Ghosted and Discarded, literal case-insensitive substring search over ID, `#ID`,
  company, role, notes and latest discard reason), sorts with the TUI comparators (grouped status
  order, material-first promotion for the Evaluated filter, nulls last, bigint ID ties ascending)
  and pages with HMAC-signed offset cursors bound to the normalized query. Stale or tampered
  cursors are a safe 400. Items carry decimal-string IDs and revisions, nullable dates, a manual
  `salary` pair and a `compensation` projection; notes and paths never reach the wire.
- `overview` ports `ComputeMetrics` and `ComputeProgressMetrics`: non-Pending totals and
  by-status counts, actionable count, average and top score, the funnel with Go's zero-denominator
  rules, score buckets and the last eight ISO weeks of added-date activity.

Database driver errors become `DatabaseUnavailableError`; missing relations become
`SchemaNotReadyError`. The module performs no writes.

**Tests:** `node --test src/server/test-jobs-read.mjs` (synthetic rows) and
`src/server/test-jobs-database.mjs` (isolated PostgreSQL through `node src/helpers/db-test.mjs`).
