# src/helpers/prune-reports.mjs

**Kind:** admin command
**Purpose:** Retires evaluation report files that no database record references by moving them from `data/evaluations/` into `data/evaluations/.trash/`. It refuses to touch any file whose name still appears in `jobs.report_path` or `evaluations.report_path`, so the database link is the liveness signal and nothing referenced can disappear.

## Run
- `node src/helpers/prune-reports.mjs <filename> [<filename> ...]`: filenames relative to `data/evaluations/`; all are validated first and nothing moves if any one fails
- `node src/helpers/prune-reports.mjs --list`: print the contents of `.trash/`
- no arguments: usage, exit 1

## Reads
- PostgreSQL: `SELECT report_path FROM jobs UNION SELECT report_path FROM evaluations`
- `data/evaluations/<filename>` existence, `data/evaluations/.trash/` listing

## Writes
- Renames `data/evaluations/<filename>` to `data/evaluations/.trash/<filename>` (folder created on demand)

## Imports
- `src/lib/_database.mjs` (`root`, `query`)

## Used by
- none found in code; the user's memory notes name it as the only sanctioned way to retire reports

## Notes
- The reference check is a substring match of the filename against all stored paths joined with newlines; a filename that is a substring of another report's name would be treated as referenced (conservative direction).
- `.trash/` is covered by the `data/evaluations/*` rule in `.gitignore`.
- Observation: `--list` and validation exit before `close()` is called; the pool's `allowExitOnIdle` lets the process exit anyway.
