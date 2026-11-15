# src

Backend of the dashboard: deterministic Node ESM launchers and the local HTTP server. This README is
the whole documentation for this branch; there are no per-file pages. Authority for anything it
summarises is named next to it. Node 24 or newer.

## Folders

| Folder         | What it is                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/`         | Modules imported by two or more functions, never run directly: database access and its test guard, CLI worker runtime, prompt rendering, JD and run-status helpers, LLM usage and price accounting, `yoe.mjs` (years-of-experience estimate). Root resolution is only through `root.mjs`. |
| `helpers/`     | Commands a person runs by hand: database, migrations, status moves, JD sync, maintenance, service launcher, Discord tools.                                                                                                                                                                |
| `scan/`        | Portal scanning (`providers/` per ATS or board), pasted-JD intake, the location gate, the posting liveness check.                                                                                                                                                                         |
| `eval/`        | Job evaluation.                                                                                                                                                                                                                                                                           |
| `cvgen/`       | CV and cover-letter drafting, PDF rendering, `templates/` (HTML and fonts).                                                                                                                                                                                                               |
| `analytics/`   | Outcome patterns and follow-up cadence.                                                                                                                                                                                                                                                   |
| `server/`      | The local API and static server for `web/`.                                                                                                                                                                                                                                               |
| `test-all.mjs` | Discovers every `test-*.mjs` under `src/` and runs the repository checks.                                                                                                                                                                                                                 |

A script lives in the folder of the function it serves, with its tests beside it as `test-*.mjs`.
Prompts never live here; they are in `llm/`.

## Launchers (what the dashboard runs)

Each launcher takes `--dry-run` (resolve inputs, write nothing) and most take `--prepare-only`
(write the run folder, no model call). Workers are isolated subscription-CLI calls (Claude or
Codex login only; API keys are stripped from their environment by `lib/cli-runtime.mjs`).

| Command                                                                                                                              | What it does                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `node src/scan/scan.mjs [--dry-run] [--report-json path]`                                                                            | Discover postings from `config/portals.yml`, cache full JDs under `data/jds/`, create jobs.          |
| `node src/scan/add-pasted-jd.mjs [--dry-run]`                                                                                        | One job from a pasted posting (JSON on stdin); text kept verbatim.                                   |
| `node src/scan/liveness.mjs --job=ID \| --all [--dry-run]`                                                                           | Check whether saved Pending, Evaluated and Applied postings are still open; stores `posting_checks`. |
| `node src/eval/evaluate-jobs.mjs --job=ID \| --select="terms" \| --next=N [--resume=RUN_ID] [--provider=claude\|codex] [--model=ID]` | Evaluate. Also `--doctor`, `--smoke`, `--smoke-research`, `--smoke-evaluation`.                      |
| `node src/cvgen/draft-cv.mjs --job=ID`                                                                                               | Draft the CV from the evaluation report; renders the PDF. `--doctor` checks both logins.             |
| `node src/cvgen/draft-cover-letter.mjs --job=ID`                                                                                     | Draft the cover letter as its own call.                                                              |
| `node src/cvgen/publish-cover-letter.mjs <cover-letter.md>`                                                                          | Render an edited letter to PDF.                                                                      |
| `node src/cvgen/generate-pdf.mjs in.html out.pdf [--format=letter\|a4]`                                                              | HTML to PDF with Playwright.                                                                         |
| `node src/eval/next-jobs.mjs --json [N] [--select=terms] [--id=ID]`                                                                  | List Pending jobs (used by the evaluator).                                                           |

### Evaluation, what an operator must know

- Selection: Pending jobs (`--next`, `--select`) or an ID. An explicit `--job=ID` also re-evaluates
  an Evaluated job: score and report refresh, a new `evaluations` row is added, a new immutable
  report file is written and `jobs.report_path` points at it. Other statuses are rejected.
- JDs come from the database or `data/jds/` only. A missing JD yields a minimal Discarded report
  with no model call. An ambiguous location returns REVIEW and leaves the job Pending; fix the
  cached evidence and start a new run. Pasted JDs (`source: manual-paste` in the stored
  frontmatter) skip the location gate; every other phase still runs.
- Company research is cached under `data/company-info/` with 90-day per-section freshness, checked
  in code; only missing or stale sections are researched, once per company per run. Research gets
  no candidate data. Failed sections are recorded as unavailable, never stamped fresh.
- Workers return the literal JSON worksheet embedded in their prompt; the launcher validates it,
  renders the report, computes the weighted score (the model never does) and publishes in one
  transaction. A format repair has web tools disabled; valid sections are kept in a checkpoint.
- Evidence: everything for a run is under `logs/evaluation/<run>/`, including a snapshot of every
  prompt used. `--resume` reuses matching stages; changed candidate inputs or JD need a new run.
- Exit codes: 0 complete or prepared, 2 some jobs FAILED or REVIEW, 1 launcher failure.
- Per-job and per-company database leases stop competing runs; expired leases can be taken over.
- Defaults and overrides: `config/evaluation-cli.json` (optional), executable paths borrowed from
  `config/cv-drafting.json`. Evaluating never drafts a CV or PDF, and the score gates nothing.

### Drafting, what an operator must know

- CV and cover letter are always two separate calls with separate prompts; there is no combined
  worksheet, and the retired `--cover-letter` / `--letter-only` flags are rejected. The dashboard
  starts them as two independent tasks.
- An evaluation report is required by both launchers (`--without-report` only with the user's
  say-so). The CV worker sees the compact CV, the JD, the style guide and Block E of the report.
  The letter worker never sees the CV worksheet, the CV answer or the report's plan.
- CV validation: exact-path errors go to a repair worker that returns only the failed block, merged
  into the previous answer; unparseable JSON and over-page-limit PDFs have their own repair prompts;
  CLI failures re-run. One budget (`max_repairs`, default 2, range 0-3) covers all of them. A CV is
  never shipped over `max_pages` (default 2).
- Titles, employers, dates, education and contact details come from `config/cv.md` and
  `config/profile.yml` by slot marker, never from the model. A missing or duplicate slot fails the run.
- Output is `output/<company>/<role>--<job-id>/`; a per-artifact lock in `logs/drafting/locks/` lets a
  CV and a letter run side by side but not two of the same. Run evidence: `logs/drafting/runs/<run>/`.
- The CV is rendered from `cvgen/templates/cv-structured.html` (placeholders `{{TITLE}}`, `{{CONTENT}}`; fonts beside it). Change look and layout there.
- Every draft is for the user to review; no automatic visual QA beyond page count.

## Maintenance commands

| Command                                                                                | What it does                                                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `node src/helpers/move-status.mjs ID STATUS [reason] [--dry-run]`                      | Revision-checked status transition through the SQL function.                                                           |
| `node src/helpers/job-update.mjs ID --role=TITLE --note=TEXT [--revision=N]`           | Revision-checked role and notes edit.                                                                                  |
| `node src/helpers/inspect-pipeline.mjs jobs \| job ID \| cache`                        | Dump jobs, one job, or the JD cache.                                                                                   |
| `node src/helpers/sync-jds.mjs [--apply] [--job=ID] [--file=PATH]`                     | Audit (default) or sync JD files into `job_descriptions`; tags files with `career-ops-job-id` (keep it when renaming). |
| `node src/helpers/backfill-yoe.mjs [--apply] [--all] [--job=ID]`                       | Years-of-experience estimate for stored JDs; dry run prints counts and a 20-row sample.                                |
| `node src/helpers/verify-pipeline.mjs`                                                 | Every stored report and JD path resolves.                                                                              |
| `node src/helpers/verify-portals.mjs`                                                  | Portal configuration diagnostics.                                                                                      |
| `node src/helpers/prune-reports.mjs <file...> \| --list`                               | Retire named reports to `data/evaluations/.trash/` (writes by default).                                                |
| `node src/helpers/prune-logs.mjs [--apply]`                                            | Retention for `logs/` and `data/backups/` (dry run default).                                                           |
| `node src/helpers/import-llm-usage.mjs [--estimate-drafting] [--since=DATE] [--apply]` | Backfill `llm_calls` from run logs or estimate old drafting runs (dry run default).                                    |
| `node src/helpers/legacy-tasks.mjs`                                                    | Read-only check for task records left by the retired TUI.                                                              |
| `node src/analytics/analyze-patterns.mjs`, `followup-cadence.mjs [--applied-days N]`   | Outcome patterns; follow-up urgency.                                                                                   |

Development-lead tooling (not part of the product): `powershell -File src/helpers/Start-ClaudeLead.ps1 [-Check] [-Resume] [-NoDiscord]`
starts the Claude Code lead with the Discord bot; `Start-DiscordLead.ps1 -Configure` saves its settings;
`node src/helpers/discord-message.mjs --dm 'text' [--send]` is a dry-run-first owner DM;
`node src/helpers/discord-approval.mjs --message=ID [--mark] [--wait=SECONDS]` reads the owner's check-mark reaction
on one of the lead's own DMs. The lead's normal channel is the `career_discord` MCP server in `.mcp.json`.

Frontend scripts (`web:dev`, `web:types`, `web:typecheck`, `web:build`) are in `web/README.md`.

Database commands (`db-infra`, `db-migrate`, `db-schema`, `db-test`, `import-legacy`, `db-cutover`)
are in `infra/README.md`.

## Server (`server/`)

Fastify on `127.0.0.1:4310` (`PORT` overrides), serving `web/dist/` and `/api/v1`. Authority for every
request and response is `server/schemas.mjs`; `npm run web:types` generates the frontend types from it.
Host and Origin are checked against loopback; writes need the session nonce from `GET /session`
(sent as a header, never logged). Private paths, driver errors, candidate configuration and secrets
never reach a response. Database trouble is a 503, never a fallback.

| Route                                                                                             | Purpose                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`, `/ready`, `/session`                                                               | Liveness, readiness (database, schema), session nonce.                                                                                                                                                                                                                                 |
| `GET /overview`                                                                                   | Status counts, funnel, score buckets, weekly activity.                                                                                                                                                                                                                                 |
| `GET /jobs`                                                                                       | List: `q` (AND, OR, NOT, phrases, parentheses), `filter`, `sort` (score, statusDate, addedDate, company, favorite, yoe), `direction`, `grouped`, `limit`, signed `cursor`, `scoreMin/Max`, `addedWeek`, `favorite`, `yoeMax`, `yoeUnknown=exclude`, `posting=expired\|applied-closed`. |
| `GET /jobs/:id`                                                                                   | Detail: job, JD, materials, latest posting check.                                                                                                                                                                                                                                      |
| `POST /jobs/:id/status`, `PATCH /jobs/:id/metadata`, `PUT /jobs/:id/jd`, `PUT /jobs/:id/favorite` | Writes: revision-checked status, one-field metadata, JD save (database first, cache file second; refreshes the YOE estimate), favorite label.                                                                                                                                          |
| `GET /jobs/:id/materials/:key[/:filename]`                                                        | Report, CV, letter files, contained to the job's folders.                                                                                                                                                                                                                              |
| `GET/PUT /jobs/:id/letter`, `GET /jobs/:id/letter/pdf`                                            | Edit and render the cover letter.                                                                                                                                                                                                                                                      |
| `POST /runs`, `POST /runs/evaluate-batch`, `POST /runs/groups/:id/cancel-queued`                  | Start a launcher by action (`evaluate`, `cv`, `letter`, `scan`, `intake`, `publish`, `liveness`) with a `requestKey` for idempotence.                                                                                                                                                  |
| `GET /runs`, `/runs/:id`, `/runs/:id/log`, `/runs/:id/scan-report`                                | Run records (PostgreSQL `browser_runs`), log tail, scan summary.                                                                                                                                                                                                                       |
| `POST /intake/check`, `/intake/fetch`, `/intake/preview`, `/intake`; `GET /intake/companies`      | Pasted or fetched postings: duplicate check, fetch, preview, add.                                                                                                                                                                                                                      |
| `GET/PUT /settings/providers[/:function]`, `POST /settings/providers/readiness`                   | Provider and model selection per function; login checks.                                                                                                                                                                                                                               |
| `GET /cost/summary`, `/cost/calls`                                                                | Token usage and cost views from `llm_calls`.                                                                                                                                                                                                                                           |
| `GET /liveness/summary`                                                                           | Latest full posting check totals.                                                                                                                                                                                                                                                      |

Modules: `app.mjs` (routes, guards), `jobs-read/detail/write/search/materials/compensation/paths.mjs`
(data layer), `runs.mjs` + `runs-store.mjs` (launcher dispatch and persistence; launchers are spawned
with argument arrays, never shell strings), `intake*.mjs`, `ghosting.mjs` (scheduled: Applied jobs with no response after 40 days become Ghosted),
`liveness.mjs` (posting-check runs started from the dashboard; the daily run is off behind
`LIVENESS_DAILY_ENABLED` in `app.mjs` until reviewed), `providers.mjs`, `cost.mjs`,
`letter.mjs`, `readiness.mjs`, `static.mjs`, `start.mjs`. Reads are parameterised SELECTs through
`lib/_database.mjs`; writes go through the SQL transition functions with the expected revision.

Run it: `npm run web:start` (foreground), or `npm run web:install` once for the always-on Windows
service (`web:up`, `web:down`, `web:restart`, `web:status`, `web:uninstall`; log
`logs/dashboard/server.log`). After `npm run web:build`, run `npm run web:restart`.

## Tests

| Command                                                | What it does                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `node src/test-all.mjs --quick`                        | Syntax and unit tests, web typecheck, data-contract and README checks. Run before reporting done. |
| `npm test`                                             | The same plus the web production build.                                                           |
| `node src/<function>/test-<name>.mjs`                  | One test file.                                                                                    |
| `node src/helpers/db-test.mjs`                         | Creates `career_ops_test_integration` and runs every database-backed suite there.                 |
| `npx prettier --write <file>` / `npm run format:check` | Prettier (`.prettierrc.json`: width 100, single quotes).                                          |

Database-backed tests print `SKIPPED` without `TEST_DATABASE_URL`, which must name a database starting
`career_ops_test_`. Every test sets `CAREER_OPS_TEST_GUARD=1`, which makes `lib/_database.mjs` refuse
any other database. Skipped integration checks are reported as skipped, never as passed.

## Rules a maintainer must not break

- PostgreSQL owns jobs, statuses, scores, evaluation history and IDs. No writable file store, no
  fallback; a database outage is an error. Status writes use the SQL transition functions with the
  expected revision.
- Anything that mutates data has a dry-run mode that is the default (`sync-jds`, `prune-logs`,
  `backfill-yoe`, `import-legacy`, `import-llm-usage`).
- Tests never reach the personal database; use `db-test.mjs`.
- Launcher and prompt are a pair: a placeholder or response key renamed in one is renamed in the other
  (`llm/prompts/`); unresolved placeholders are rejected.
- JD text comes from the database or `data/jds/`, never a browser, during evaluation or drafting.
  Known posting URLs are never re-inserted (unique constraint).
- hiring.cafe discovery follows the mandatory provider contract in `AGENTS.md`.
- The posting check never requests or renders hiring.cafe, LinkedIn or Indeed links (unknown, `not-checked`), and stops requesting a host for the rest of a run after its first 429.
- Never submit an application; every CV, letter or answer is a draft. Never start a CV or PDF as a
  side effect of evaluating; a score never blocks an explicit action.
- No candidate facts in `src/`; they enter prompts at run time from `config/` and `llm/compacted/`.
- New source files get a `test-*.mjs` beside them and are formatted with Prettier.
