# infra

PostgreSQL for the whole project: ordered migrations, a generated schema snapshot, and the Docker
Compose setup. This README is the whole documentation for this branch.

| Path | What it is |
|---|---|
| `sql/migrations/NNN_name.sql` | The authoritative, ordered, **immutable** history. |
| `sql/schema.sql` | Generated review snapshot of the migrations; never hand-edited. |
| `docker/compose.yml`, `.env.example`, `setup-windows.ps1` | Local database container, its template env file, and a Windows Docker/WSL diagnostic (`-Enable` needs an administrator shell). |

## What the database owns

PostgreSQL is the only operational store for jobs, statuses, scores, evaluation history and ID
allocation. Files under `data/` are readable caches or work product; paths stored in the database
are relative to the repository root. Outages are errors; there is no file fallback.

Main tables: `jobs` (permanent IDs, status, revision, favorite), `job_status_events` (every
transition; `created_at` is when recorded, nullable `occurred_at` is when it happened, and
unknown dates stay null), `evaluations` (immutable completion keys and report paths),
`job_descriptions` (exact Markdown by job ID, hash, revision, and the `yoe_min` /
`yoe_confidence` estimate), `scan_history`, `workflow_claims` (renewable leases for jobs and company
research), `browser_runs` (dashboard-launched runs; once-only, forward-only transitions through four
SQL functions), `llm_calls` (token accounting only), `posting_checks` (liveness checks; "flagged" is
derived from the latest one, never stored on `jobs`). Business rules live in SQL functions
(`create_job`, `change_job_status`, `sync_job_description`, `ghost_stale_applications`, run
transitions); callers pass the expected revision.

## Statuses

`jobs.status` is exactly the labels in the CHECK constraint (authority: `sql/schema.sql`):

| Status | Meaning |
|---|---|
| `Pending` | Discovered, awaiting evaluation |
| `Evaluated` | Report completed, awaiting a decision |
| `Applied` | Application sent (records `applied_at`) |
| `Interview` | In the interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by the company |
| `Ghosted` | Applied with no response after more than 40 days; set automatically |
| `Discarded` | Discarded by the candidate or the evaluation gate, with a recorded reason |

To add or rename a status: a numbered migration that alters the CHECK and the transition function,
regenerate the snapshot, then update `src/server/jobs-write.mjs`, `src/server/schemas.mjs` and `web/src/`.

## Migrations

- Never edit an applied migration. A schema or data change is a new numbered file; the runner records
  checksums and takes a migration lock, so an edited file is detected.
- Add one: create `sql/migrations/NNN_name.sql` (next number, additive where possible, comment saying
  why), run `npm run db:migrate`, then `node src/helpers/db-schema.mjs` to regenerate `schema.sql`
  (`--check` verifies it; CI does). Test it with `node src/helpers/db-test.mjs`.
- A migration that touches the dashboard tables is exercised by `src/helpers/test-rollback-rehearsal.mjs`
  (apply, roll back, re-apply in a throwaway schema). Roll back on the personal database only with a
  fresh backup and the owner's go-ahead.

## Commands

| Command | What it does |
|---|---|
| `node src/helpers/db-infra.mjs init` | Create the private `.env` with a random password (refuses to overwrite). |
| `npm run db:up` / `db:down` | Start and wait for healthy / stop (the data volume is kept). |
| `npm run db:migrate` | Apply pending migrations. |
| `npm run db:schema` | Regenerate `schema.sql`. |
| `npm run db:backup` | Custom-format dump into `data/backups/` (`.partial` until complete). |
| `node src/helpers/db-infra.mjs restore FILE career_ops_restore_NAME` | Restore into a **new** database whose name starts `career_ops_restore_`; never over the personal one. |
| `node src/helpers/db-infra.mjs status` / `config` | Container status; validate the Compose file. |
| `node src/helpers/db-test.mjs` | Isolated integration run (below). |
| `node src/helpers/import-legacy.mjs [--apply] [--archive]`, `db-cutover.mjs` | Recovery from the retired file store only. Audit by default; apply needs an empty database; sources are archived before import. |

Connection: `127.0.0.1:54329`, database and user `career_ops`, read from the private `.env`;
`DATABASE_URL` overrides it. Never commit passwords, volumes, backups or imported personal data.
A fresh install needs no legacy import.

## Backup and restore check

`npm run db:backup`, restore into `career_ops_restore_<stamp>`, compare per-table `count(*)` against
`career_ops` with read-only queries (counts only, never rows), then drop the restore database.

## Isolated test database

`node src/helpers/db-test.mjs` creates `career_ops_test_integration` and runs every database-backed
suite against it through `TEST_DATABASE_URL`. That variable must name a database starting
`career_ops_test_`, and tests set `CAREER_OPS_TEST_GUARD=1` so `src/lib/_database.mjs` refuses any
other. Never point a test at `career_ops`.

## JD synchronisation

Scanning and pasted-JD intake publish the readable file, then create the job and sync its content in
one transaction (`src/lib/_job-descriptions.mjs`, `syncJD`). Evaluation, drafting by ID and the
dashboard read the database copy. `node src/helpers/sync-jds.mjs` audits linked files and `--apply`
re-syncs after an intentional edit or interrupted intake; unchanged content does not bump the
revision. A rename keeps working while the `career-ops-job-id` marker stays in the file; relink an
older file with `--job=ID --file=data/jds/<folder>/<file>.md`. Renaming a file never changes the
stored role title (`job-update.mjs ID --role=...`). There is no fuzzy title matching.

## CI

`.github/workflows/test.yml` runs `node src/test-all.mjs --quick` on pull requests to `main`.
`database.yml` runs on every push: schema check, a Compose database, `db-test.mjs` and the real PDF
render test.
