# src/helpers/job-update.mjs

**Kind:** admin command
**Purpose:** Changes a job's role title and/or appends a note through the `update_job_metadata` SQL function, which enforces an optimistic revision check. It exists so metadata edits go through the same revision-guarded path as status changes instead of raw `UPDATE` statements.

## Run
`node src/helpers/job-update.mjs ID --role=TITLE --note=TEXT [--revision=N]`
- `ID`: numeric permanent job ID (required)
- `--role=`: new title (may not be blank after trimming)
- `--note=`: text appended to `jobs.notes` on a new line
- `--revision=`: expected current revision; defaults to the revision read just before the update
At least one option is required; any other flag is a usage error. Prints the updated row as JSON.

## Reads
- PostgreSQL: `jobs` (`getJob` for the current revision)

## Writes
- PostgreSQL: `update_job_metadata(id, revision, role, note)` updates `jobs.role`, `jobs.notes`, `jobs.revision`, `jobs.updated_at`

## Imports
- `src/lib/_database.mjs` (`getJob`, `query`, `close`)

## Used by
- none found (no package.json alias, dashboard call or script references it; run by hand)

## Notes
- If the row changed between the `getJob` read and the update, PostgreSQL raises "Revision conflict for job N; refresh and retry" (SQLSTATE 40001).
- Options are parsed by splitting at the first `=`, so values may contain `=`; quote values containing spaces in your shell.
