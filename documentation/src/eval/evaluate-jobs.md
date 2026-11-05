# src/eval/evaluate-jobs.mjs

**Kind:** launcher
**Purpose:** The standalone job-evaluation launcher. It selects Pending jobs, runs a location gate for non-manual jobs, company and role-market research, and the scored evaluation worksheet through an isolated subscription CLI worker (claude or codex), renders the Markdown report and publishes each result to PostgreSQL under a lease. JDs carrying the manual-intake frontmatter marker skip the location gate because dashboard intake already represents the user's eligibility decision. It exists so evaluation is deterministic, resumable and archived, and never improvised by an interactive agent.

## Run
`node src/eval/evaluate-jobs.mjs --job=123 | --select="company role" | --next=5 [--provider=claude|codex] [--dry-run] [--prepare-only]`
- `--job=ID` / `--select=terms` / `--next=N`: exactly one selector (resolved through `src/eval/next-jobs.mjs`; `--job` must be a numeric permanent ID that is still Pending).
- `--provider`: `claude` (default) or `codex`; must match the run on `--resume`.
- `--dry-run`: print provider, models and selected jobs; no run folder, no CLI, no DB writes.
- `--prepare-only`: create the run folder with prompt sources and gate prompts, acquire and release the run lease, no CLI calls; prints `Run: <id>`.
- `--resume=RUN_ID`: reload `logs/evaluation/<id>/run.json`; cannot be combined with selectors or preparation; a completed run just prints its results.
- `--doctor`: JSON login status of the provider. `--smoke`, `--smoke-research`, `--smoke-evaluation`: one synthetic CLI call each (no DB, no candidate facts).
- Exit code 0 complete, 2 needs-attention (any FAILED/REVIEW result), 1 launcher failure (prints the resume command).

## Reads
- `config/cv-drafting.json` (`claude_command`, `codex_command`); `config/evaluation-cli.json` (optional overrides: `default_provider`, `claude_model`, `claude_research_model`, `codex_model`, `codex_research_model`, `timeout_ms`, `max_repairs` 0-3, `max_concurrency`)
- `llm/compacted/cv-compact.md`, `llm/compacted/candidate-targeting.md`, `llm/prompts/eval/{scoring,gate,evaluate,company-research,market-research,repair}.md`, `llm/prompts/runtime/{no-tools,research}.md` (snapshotted into the run; the run aborts if any changed since)
- `data/company-info/<company-slug>.md` (per-section freshness); `logs/evaluation/<run-id>/run.json` on resume; `git rev-parse HEAD` for `worker_runtime.source_revision`
- PostgreSQL: `jobs` (through next-jobs), `job_descriptions` (`getJD`, re-checked before evaluation and before publish), `scan_history` (last 30 sightings by company+title or URL), `workflow_claims`; `DATABASE_URL` through `src/lib/_database.mjs`

## Writes
- `logs/evaluation/<run-id>/`: `run.json`, `prompt-sources/<path>`, `<job>/gate.prompt.txt` for non-manual jobs, per-phase `*.prompt.txt`, `*.response.txt`, `*.stdout.log`, `*.stderr.log`, `<phase>.json` checkpoints, `companies/<slug>/research*`, `reports/<job>.md`; `smoke-<uuid>/` for smoke modes
- `data/company-info/<slug>.md` (merged research sections); `data/evaluations/<id>-<slug>-<date>-<run-id>.md` (immutable, via `publishEvaluation`); `logs/token-usage/*.json` when debug logging is enabled
- PostgreSQL: `claim_work` leases `evaluation-run:<id>`, `evaluation:<job>`, `research:<company>` (rows deleted from `workflow_claims` on release); `complete_evaluation(...)` per job (updates `jobs`, inserts `evaluations`); `jobs.evaluation_error` for FAILED/REVIEW rows still under lease

## Imports
- `src/lib/_job-descriptions.mjs` (`getJD`)
- `src/lib/_database.mjs` (`query`, `close`)
- `src/lib/_job-workflows.mjs` (`publishEvaluation`, `lease`)
- `src/eval/_evaluation-worksheet.mjs` (`passthrough`, `researchDecode`, `evaluationDecode`)
- `src/eval/_evaluation-cli.mjs` (validators, `render`, `invoke`, `pool`, `companyPrompt`, `researchNeeded`)
- `src/eval/_evaluation-plan.mjs` (`RESEARCH_SECTIONS`)
- `src/lib/cli-runtime.mjs` (`draftingRoot`, `temporaryWorker`, `checkLogin`, `processRun`)
- `src/lib/_prompt-templates.mjs` (`renderPrompt`); `src/lib/root.mjs`
- spawns `src/eval/next-jobs.mjs --json` as a child process for selection
- `src/lib/_task-status.mjs` (`reportPhase`)

## Used by
- `dashboard/workflow.go` (action `evaluate` runs `--job=N`; exit 2 is shown as "needs attention"), `dashboard/workflow_test.go`
- `src/eval/test-evaluation-cli.mjs` (spawns a fixture copy with a mocked CLI when `TEST_DATABASE_URL` is set)

## Counterpart prompt(s)
- `llm/prompts/eval/gate.md`: `{{CACHED_JD}}`
- `llm/prompts/eval/market-research.md`: `{{COMPANY}}`, `{{ROLE}}`, `{{LOCATION}}` (from the gate answer), `{{DATE}}`
- `llm/prompts/eval/company-research.md` (through `companyPrompt`): `{{COMPANY}}`, `{{EMPLOYER_URLS}}`, `{{EXISTING_CACHE}}`, `{{DATE}}`
- `llm/prompts/eval/evaluate.md`: `{{SCORING_RUBRIC}}`, `{{CANDIDATE_FACTS}}`, `{{TARGETING}}`, `{{COMPANY}}`, `{{ROLE}}`, `{{DATE}}`, `{{JOB_DESCRIPTION}}`, `{{MARKET_SALARY_CONTEXT}}`, `{{SCAN_HISTORY}}`
- `llm/prompts/eval/repair.md` (appended by `invoke` after a validation failure): `{{VALIDATION_ERRORS}}`, `{{PREVIOUS_RESPONSES}}`
- `llm/prompts/runtime/no-tools.md`, `llm/prompts/runtime/research.md`: system prompts selected by `cliSpec` (claude only)

## Notes
- Phase order: select, classify `source: manual-paste` from JD frontmatter, snapshot sources, lease run, write gate prompts for non-manual jobs, (stop if `--prepare-only`), verify sources and JDs unchanged, login check, per-job leases, gate non-manual jobs (manual intake receives an auditable synthetic PASS without a model call), one company research per unique company among PASS jobs (skipped when both cache sections are under 90 days old), then per job: market research (PASS only), evaluation, input re-check, render, stage `reports/<job>.md`, publish.
- Progress is reported to the dashboard task registry through `reportPhase` (`preparing`, then the phase and attempt of each CLI call from `_evaluation-cli.mjs`); the `git rev-parse` source-revision probe is spawned with `windowsHide`. Runs started from a terminal have no task record and reporting is a no-op.
- Outcomes: gate FAIL or a missing cached JD renders a stub with status `Discarded`; REVIEW and worker failures are not published and set `jobs.evaluation_error`.
- `{{MARKET_SALARY_CONTEXT}}` is the fixed sentence "No inferred salary context" when the JD already contains a currency amount; otherwise only research paragraphs containing an amount are injected.
- Gate and research use the `*_research_model`; evaluation uses the `*_model`. Research phases run with `partial: true`, so validated sections survive a failed repair.
- Resume replays `state.staged` results without CLI calls (the staged report must still exist); `invoke` checkpoints reuse identical prompts, so only failed phases re-run.
