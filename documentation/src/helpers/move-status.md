# src/helpers/move-status.mjs

**Kind:** admin command
**Purpose:** Moves one job to a new status through the `change_job_status` SQL function, passing the row's current revision so a concurrent writer cannot be overwritten silently. It is the only sanctioned way to change `jobs.status` from the command line.

## Run
`node src/helpers/move-status.mjs ID STATUS [reason ...]`
- `ID`: numeric permanent job ID
- `STATUS`: one of the canonical labels (`Pending`, `Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`, `Ghosted`, `Discarded`); the database constraint rejects anything else
- `reason`: remaining words joined with spaces; appended to `jobs.notes` and stored on the status event. It is required when `STATUS` is `Discarded`.
Prints the updated row as JSON.

## Reads
- PostgreSQL: `jobs` (`getJob` for the current revision)

## Writes
- PostgreSQL: `change_job_status(id, revision, status, reason, 'cli')` updates `jobs` (status, revision, `applied_at` when entering Applied, notes) and inserts a `job_status_events` row with actor `cli`

## Imports
- `src/lib/_database.mjs` (`query`, `getJob`, `close`)

## Used by
- Referenced by name in `AGENTS.md` as the transition command; no script, alias or dashboard code invokes it

## Notes
- The revision is read immediately before the call, so the check protects against writes racing this command, not against a stale value the operator holds.
- A wrong status label or an unknown ID surfaces as a PostgreSQL error and a non-zero exit.
