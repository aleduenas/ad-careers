# Command reference

Every runnable command, grouped by function. Paths are relative to the repository root; run
them from there. Discovery, evaluation and drafting require `--dry-run` for previews. Status/metadata changes,
publishing and database operations write when invoked; maintenance commands document their
own preview/apply flags below. Per-file
detail (inputs, outputs, callers) is in `documentation/src/`.

## Daily workflow (what the dashboard runs)

| Command | What it does |
|---|---|
| `node src/scan/scan.mjs [--dry-run] [--report-json path]` | Discover new postings from `config/portals.yml` through the providers under `src/scan/providers/`; cache JDs under `data/jds/`; create jobs in PostgreSQL. `npm run scan` |
| `node src/scan/add-pasted-jd.mjs [--dry-run]` (JSON on stdin) | Create one job from a pasted posting; JD kept verbatim. The dashboard's paste action |
| `node src/eval/evaluate-jobs.mjs --job=ID \| --select="company role" \| --next=N [--dry-run] [--prepare-only] [--resume=RUN_ID] [--provider=claude\|codex]` | Evaluate Pending jobs: location gate, research, scored report, transactional publication. See `EVALUATION_CLI.md` |
| `node src/cvgen/draft-cv.mjs --job=ID [--dry-run] [--prepare-only]` | Draft the CV only from the evaluation report and compact CV; renders the PDF into `output/<company>/<role>--<job-id>/`. `npm run draft:cv` |
| `node src/cvgen/draft-cover-letter.mjs --job=ID [--dry-run] [--prepare-only]` | Draft the cover letter as its own call; writes `cover-letter.md` into the same folder. CV + letter means running both launchers (the dashboard starts them as two tasks) |
| `node src/cvgen/publish-cover-letter.mjs output/<company>/<role>--<job-id>/cover-letter.md` | Render an edited letter to PDF |
| `node src/cvgen/generate-pdf.mjs input.html output.pdf [--format=letter\|a4]` | Low-level HTML to PDF (Playwright). `npm run pdf` |

## Jobs and data maintenance

| Command | What it does |
|---|---|
| `node src/eval/next-jobs.mjs --json [N] [--select="terms"] [--id=ID]` | List Pending jobs (used by the evaluator) |
| `node src/helpers/inspect-pipeline.mjs jobs \| job ID \| cache` | Dump jobs, one job, or the JD cache. `npm run inspect` |
| `node src/helpers/move-status.mjs ID STATUS [reason] [--dry-run]` | Revision-checked status transition through the SQL function |
| `node src/helpers/job-update.mjs ID --role=TITLE --note=TEXT [--revision=N]` | Revision-checked role/notes metadata edits |
| `node src/helpers/sync-jds.mjs [--apply]` | Audit (default) or synchronize readable JD files with `job_descriptions` |
| `node src/helpers/verify-pipeline.mjs` | Every stored report/JD path resolves. `npm run verify` |
| `node src/helpers/verify-portals.mjs` | Portal configuration diagnostics and provider coverage. `npm run verify:portals` |
| `node src/helpers/prune-reports.mjs <file...> \| --list` | Retire named report files into `data/evaluations/.trash/` (writes by default; use deliberately) |
| `node src/helpers/prune-logs.mjs [--apply]` | Retention policy for `logs/` and `data/backups/` (dry-run default) |

## Analytics

| Command | What it does |
|---|---|
| `node src/analytics/analyze-patterns.mjs` | Outcome patterns across statuses and reports |
| `node src/analytics/followup-cadence.mjs [--applied-days N]` | Follow-up urgency for Applied/Interview jobs, dated from status events |

## Database

| Command | What it does |
|---|---|
| `node src/helpers/db-infra.mjs init \| up \| down \| status \| config \| backup [file] \| restore file career_ops_restore_NAME` | Docker Compose lifecycle and custom-format dumps (`.partial` until complete). `npm run db:up`, `db:down`, `db:backup` |
| `node src/helpers/db-migrate.mjs` | Apply pending numbered migrations with checksums. `npm run db:migrate` |
| `node src/helpers/db-schema.mjs [--check]` | Regenerate or verify `infra/sql/schema.sql`. `npm run db:schema` |
| `node src/helpers/db-test.mjs` | Provision an isolated test database and run the Node + Go integration suites. `npm run db:test` |
| `node src/helpers/import-legacy.mjs [--apply] [--archive]` | Legacy file-store recovery only (audit by default). `npm run db:audit` |
| `node src/helpers/db-cutover.mjs` | Historical one-shot cutover orchestration; recovery use only. `npm run db:cutover` |

## Tests

| Command | What it does |
|---|---|
| `node src/test-all.mjs [--quick]` | Syntax, every `src/**/test-*.mjs`, dashboard build (skipped with `--quick`), data-contract and path checks. `npm test` |
| `node src/<function>/test-*.mjs` | Any single test. Database-backed tests print `SKIPPED` without `TEST_DATABASE_URL`; use `db-test.mjs` to run them for real |
| `go test ./...` (from `dashboard/`) | Dashboard unit tests; `TestPostgresDashboardLifecycle` needs `TEST_DATABASE_URL` |

## Formatting

| Command | What it does |
|---|---|
| `npx prettier --write <file>` | Format one `.mjs` file to the repo's Prettier style (`.prettierrc.json`) |
| `node_modules/.bin/prettier --write "src/**/*.mjs"` | Format all of `src`. `npm run format` |
| `node_modules/.bin/prettier --check "src/**/*.mjs"` | Verify formatting without writing. `npm run format:check` |

## Dashboard

| Command | What it does |
|---|---|
| `go build -o dashboard.exe .` (from `dashboard/`) | Build the real binary; required after any dashboard change |
| `dashboard/launch-dashboard.ps1` | Launch against the repository root (the shortcut target) |
