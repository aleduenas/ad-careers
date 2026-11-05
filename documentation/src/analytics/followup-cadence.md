# src/analytics/followup-cadence.mjs

**Kind:** launcher
**Purpose:** Follow-up cadence tracker for active applications. It reads `Applied` and `Interview` jobs from PostgreSQL, dates each by `applied_at`, merges any logged follow-ups from `data/follow-ups.md`, computes urgency (`overdue`, `waiting`, `cold`) and the next follow-up date, extracts contact emails from notes and prints either JSON or a text dashboard. Rows with an unknown historical application date are omitted rather than dated from import/source time.

## Run
`node src/analytics/followup-cadence.mjs [--summary] [--overdue-only] [--applied-days N]`
- default: JSON `{metadata, entries, cadenceConfig}`
- `--summary`: aligned text table
- `--overdue-only`: keep only `overdue`/`urgent` entries
- `--applied-days N`: days after applying before the first follow-up is due (default 7)
Exits 1 with an error object when no non-Pending jobs exist.

## Reads
- PostgreSQL: `jobs` where `status <> 'Pending'`, with `applied_at` exposed as `date`
- `data/follow-ups.md` (optional markdown table: `| # | app# | date | company | role | channel | contact | notes |`); absent today
- `data/evaluations/<report>.md` existence only, to expose `reportPath`

## Writes
- none

## Imports
- `src/lib/_database.mjs` (`query`)
- `src/lib/root.mjs`

## Used by
- none found (no package.json alias, workflow or dashboard call); run by hand

## Notes
- Cadence constants: first follow-up after `--applied-days` (7), subsequent every 7 days, at most 2 follow-ups before an application is `cold`; interview thank-you due after 1 day.
- Report links are resolved first as `data/<link>` then `<root>/<link>`, so root-relative `data/evaluations/...` paths resolve correctly.
- Contact extraction is regex-based on the notes column (email plus a name guessed from "Emailed NAME at" or "contact: NAME").
- The `urgent` urgency level appears in sorting and counts but is never assigned by `computeUrgency`.
