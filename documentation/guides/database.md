# PostgreSQL storage

`infra/sql/migrations/` is the authoritative, ordered SQL history. `infra/sql/schema.sql` is its generated review snapshot. Do not edit applied migrations; add a numbered migration. The runner verifies checksums and takes a database migration lock.

The `jobs` table owns permanent IDs and application status. `evaluations` records immutable completion keys and reports. `job_status_events` records transitions, separating `created_at` (when PostgreSQL recorded the row) from nullable `occurred_at` (when the transition is known to have happened). `workflow_claims` holds renewable ownership leases for jobs and company research. `scan_history` replaces file-based discovery history. `job_descriptions` stores exact Markdown content keyed by permanent job ID, with file provenance, hash, revision and sync time. Readable JD files remain in private `data/jds/`; reports and generated documents remain files.

## Application statuses

`jobs.status` is constrained by the CHECK established in `infra/sql/migrations/006_status_lifecycle.sql` (see `infra/sql/schema.sql`) to exactly these labels. Status changes go through the SQL transition function (`src/helpers/move-status.mjs` or the dashboard); `job_status_events` records every transition.

| Status | Meaning |
|---|---|
| `Pending` | Discovered job awaiting evaluation |
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Ghosted` | No response more than 40 days after the recorded application date |
| `Discarded` | Discarded by candidate or the evaluation gate, with a recorded reason |

`SKIP` was merged into `Discarded` by migration 006. The dashboard runs `ghost_stale_applications()` before each load; only jobs still in Applied with a known `applied_at` more than 40 days ago move automatically. Entering Applied records `applied_at`. Migration 007 recovers exact historical application dates from legacy `Applied YYYY-MM-DD` notes. Migration 008 records status occurrence time separately and recovers old dates only from preserved evidence such as an exact application date, a dated evaluation report, or an explicit status/date note. Unrecoverable historical dates remain null; the dashboard labels them `unknown` and never substitutes the database-import timestamp.

To add or rename a status: write a numbered migration that alters the constraint and the transition function, regenerate `infra/sql/schema.sql` with `node src/helpers/db-schema.mjs`, then update the dashboard status handling in `dashboard/internal/data/career.go` and `internal/ui/screens/pipeline.go`.

## JD synchronization

Scanning and pasted-JD ingestion publish the readable file first, then create the job and synchronize its content in one database transaction. CV/letter drafting by ID, evaluation, and the dashboard JD viewer read PostgreSQL, not the file hierarchy. There is no silent file fallback on database errors. Explicit standalone drafting with `--jd` remains available for user-specified files.

Run `node src/helpers/sync-jds.mjs` to audit linked files, then `node src/helpers/sync-jds.mjs --apply` after intentional file changes or interrupted ingestion. Each job sync is independently committed and retryable; unchanged content does not increment revision. Missing linked files are errors; jobs without links are counted separately. No company/title-based merge or header normalization occurs. Evaluation runs snapshot content and reject changed database input on resume. Existing unlinked files are retained, never assigned by fuzzy title matching.

Newly ingested or synchronized JDs include an HTML comment `career-ops-job-id: ID` linking them to the permanent job/report number. Keep this marker when renaming a file. Sync can recover a missing path from exactly one tagged file; duplicate ID tags across files are rejected during recovery. To explicitly relink an older untagged file, run `node src/helpers/sync-jds.mjs --job=ID --file=data/jds/company/file.md --apply`. Changing a filename does not change the database role title: use `node src/helpers/job-update.mjs ID --role="Correct title"`. The dashboard ingestion form asks for URL, company, role title, then description; supplied company and title are authoritative, and the description is stored verbatim.

## Local setup

1. Install Docker Desktop and enable its WSL 2 Linux backend. Run `powershell -ExecutionPolicy Bypass -File infra/docker/setup-windows.ps1` to diagnose. The `-Enable` option requires administrator PowerShell and may require a restart. Enable firmware virtualization if Windows reports it disabled.
2. Run `node src/helpers/db-infra.mjs init` to create a random local password in ignored `.env`.
3. Run `npm run db:up`, then `npm run db:migrate`.
4. For legacy recovery only, audit with `npm run db:audit` and follow the migration recovery section. A fresh installation does not require a legacy cutover.
5. Launch the dashboard from the repository, or give it `--path` pointing here.

The default connection is `127.0.0.1:54329`, database/user `career_ops`. Both Node and Go read the repository `.env`, with process environment overrides. `DATABASE_URL` overrides individual settings. Do not commit passwords, database volumes, backups, or imported personal data.

## Operations

- `npm run db:up`: start and wait for a healthy database.
- `npm run db:down`: stop containers; preserve the named data volume.
- `npm run db:backup`: create a private custom-format dump under `data/backups/`.
- `node src/helpers/db-infra.mjs restore FILE career_ops_restore_NAME`: restore into a new, separate database; never overwrite the personal database.
- `npm run db:schema`: regenerate the SQL review snapshot.
- `node src/helpers/db-schema.mjs --check`: check snapshot consistency.
- `node src/helpers/inspect-pipeline.mjs jobs` or `job ID`: inspect structured records.
- `node src/helpers/move-status.mjs ID STATUS [reason]`: revision-checked status change.
- `node src/helpers/job-update.mjs ID --note="TEXT" --role="TITLE"`: update only supplied metadata; `--revision=N` detects stale edits.

Database outages are errors. There is no alternate writable file backend. Evaluation completion is per job; SQL protects status changes from late evaluation results. File publication happens before the completion transaction; an interrupted publication can leave an unreferenced report, and retry reuses the same immutable content.

## Migration recovery

Only `src/helpers/import-legacy.mjs` understands the retired file formats. Its default action audits without writes. Apply requires an empty database, or an identical previously recorded import. Source files are copied into a private archive before import and retired only after field parity succeeds. Unknown historical timestamps remain null. Backups preserve the exact original source text. Conflicting identities stop import for explicit resolution stored in private config/database-import.json. Confirmed duplicate URLs retain the more advanced application record, or the newer ID at equal status; removed records remain recoverable from the source archive.

`npm run db:test` provisions career_ops_test_integration and runs database and launcher tests there. Integration tests require `TEST_DATABASE_URL` naming a separate database with a `career_ops_test_` prefix. They must never point at `career_ops`.
