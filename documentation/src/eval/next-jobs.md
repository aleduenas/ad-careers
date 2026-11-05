# src/eval/next-jobs.mjs

**Kind:** launcher
**Purpose:** Lists Pending jobs from PostgreSQL for a person or for the evaluation launcher. It resolves a permanent ID, a free-text company/role search, or the next N by ID, and prints either one human-readable line per job or a JSON envelope that includes the planned report path.

## Run
`node src/eval/next-jobs.mjs [N] [--select=term1,term2] [--id=ID] [--json]`
- `N`: bare integer, maximum jobs when no selector is given (default 10, ordered by ID).
- `--select=terms`: comma-separated, case-insensitive substrings matched against `company + ' ' + role`; any term matches.
- `--id=ID`: a single Pending job by permanent ID (takes precedence over `--select`).
- `--json`: `{count, jobs:[{num, company, role, url, jd_path, revision, slug, report_path}]}`; otherwise `#<id> <company> — <role>` lines.

## Reads
- PostgreSQL `jobs` where `status='Pending'`; `DATABASE_URL` through `src/lib/_database.mjs`

## Writes
- none

## Imports
- `src/lib/_database.mjs` (`query`, `close`)

## Used by
- `src/eval/evaluate-jobs.mjs` (spawned with `--json` plus `--id=` or a count, and optional `--select=`)
- `src/test-all.mjs` (existence check only)
- `AGENTS.md` named-role resolution (`--json --select="company role"`)

## Counterpart prompt(s)
- none

## Notes
- `report_path` is computed as `data/evaluations/<id>-<company-role-slug>-<today>.md`; `publishEvaluation` later inserts `-<run-id>` before `.md`, so the published file name differs from this planned path.
- Read-only; always closes the pool in `finally`.
