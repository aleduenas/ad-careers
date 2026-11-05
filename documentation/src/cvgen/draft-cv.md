# src/cvgen/draft-cv.mjs

**Kind:** launcher
**Purpose:** Generates a tailored CV PDF for one job with an isolated subscription CLI call and up to `max_repairs` bounded repair calls when needed. It substitutes the cached JD, compact CV, writing style guide and evaluation report's customization plan into the literal CV worksheet prompt, validates the JSON answer, maps it onto the canonical catalog from `config/cv.md` and renders it through `src/cvgen/templates/cv-structured.html` and `src/cvgen/generate-pdf.mjs`.

## Run
`node src/cvgen/draft-cv.mjs --job=ID [--provider=claude|codex] [--dry-run] [--prepare-only]` (also `npm run draft:cv`)
- `--job=ID`: permanent job ID; resolves report, JD and output folder from PostgreSQL. Alternative: `--jd=path --report=path --out=output/company/role` (`--without-report` skips the report requirement and needs prior user authorization).
- CV only. The cover letter is always a separate call through `src/cvgen/draft-cover-letter.mjs`; the retired `--cover-letter` and `--letter-only` flags are rejected with an error naming that launcher.
- `--provider`: `claude` or `codex` (default from `config/cv-drafting.json`). `--dry-run`: print provider, prompt path, run directory and selection; no files. `--prepare-only`: write the run folder with the rendered context but make no CLI call. `--init`: create `<drafting_root>/runs`. `--doctor`: login status for both providers. `--smoke`: rejected.

## Reads
- `config/cv-drafting.json` (`default_provider`, `claude_command`, `codex_command`, `claude_model`, `codex_model`, `claude_effort`, `timeout_ms`, `drafting_root`, `max_repairs` — default 2, range 0–3; `max_pages` — default 2, range 1–4)
- `llm/prompts/cvgen/cv-worksheet.md`, `llm/prompts/cvgen/cv-repair.md`, `llm/prompts/cvgen/cv-repair-json.md`, `llm/prompts/cvgen/cv-repair-length.md`, `llm/prompts/cvgen/writing-style-guide.txt`, `llm/prompts/runtime/no-tools.md` (system prompt via `cliSpec`)
- `llm/compacted/cv-compact.md` (worker-facing CV); `config/cv.md`, `config/profile.yml`, `config/cv-content-policy.json` (catalog for rendering, through `loadCatalog`)
- the evaluation report at `jobs.report_path` (the full `## E) Customization Plan` block is extracted through the next lettered heading or end of file; historical `E.` headings also work); `src/cvgen/templates/cv-structured.html`
- PostgreSQL: `jobs` (`getJob`), `job_descriptions` (`getJD`); `DATABASE_URL` through `src/lib/_database.mjs`

## Writes
- `<drafting_root>/runs/<run-id>/`: `cv.md`, `job-description.md`, `worksheet.md`, `repair-prompt.md`, `repair-prompt-json.md`, `repair-prompt-length.md`, `writing-style-guide.txt`, `cv-customization-context.md`, `cli-context.md`, `response.json`, `stderr.log`, `rendered/worksheet-response.json`, `rendered/cv-<name-slug>.html`, `rendered/cv-<name-slug>.pdf`, `draft-run.json`; for each repair attempt `n`, also `repair-<n>-error.json` (the failure that triggered it), `repair-<n>-context.md`, `repair-<n>-response.json`, `repair-<n>-stderr.log`, and `repair-<n>-merged.json` (the previous answer with the returned block spliced in) whenever the attempt followed a validation failure. `rendered/worksheet-response.json`, `.html` and `.pdf` are overwritten on every attempt that reaches rendering, so they always reflect the most recent render, not necessarily the accepted one if the run later fails
- `<drafting_root>/locks/<out-slug>.cv.lock` for the duration of the call
- `output/<company>/<role>--<job-id>/cv-<name-slug>.pdf`
- `logs/token-usage/*.json` when debug logging is enabled; no PostgreSQL writes

## Imports
- `src/lib/_token-debug.mjs` (`logTokenUsage`)
- `src/lib/cli-runtime.mjs` (`draftingRoot`, `temporaryWorker`, `childOf`, `cliSpec`, `processRun`, `checkLogin`)
- `src/cvgen/_cv-drafting.mjs` (`resolveJob`, `candidateFileStem`, `withOutputLock`, `customizationContext`)
- `src/cvgen/_cv-worksheet.mjs` (`parseWorksheet`, `parseAnswer`, `validateAnswer`, `mergeRepair`, `adapt`, `CVWorksheetValidationError`, `CVPageBudgetError`)
- `src/cvgen/_cv-content.mjs` (`loadCatalog`, `renderHTML`)
- `src/lib/_task-status.mjs` (`reportPhase`)
- `src/lib/root.mjs`; spawns `src/cvgen/generate-pdf.mjs`

## Used by
- `dashboard/workflow.go` (action `cv`, and the `cv` half of `both`; always `--job=N`), `dashboard/workflow_test.go`
- `package.json` (`draft:cv`), `src/test-all.mjs` (existence check), `AGENTS.md` CV/cover-letter exception

## Counterpart prompt(s)
- `llm/prompts/cvgen/cv-worksheet.md`: `{{JOB_DESCRIPTION}}`, `{{CANDIDATE_CV}}`, `{{WRITING_STYLE}}`, `{{CV_CUSTOMIZATION_CONTEXT}}` (all source-template occurrences substituted once by `renderPrompt`; missing template values abort; inserted text remains literal)
- `llm/prompts/cvgen/cv-repair.md`: `{{ORIGINAL_PROMPT}}`, `{{PREVIOUS_RESPONSE}}`, `{{VALIDATION_ERRORS}}`, `{{AFFECTED_JSON}}`; invoked after a parsed response fails worksheet validation
- `llm/prompts/cvgen/cv-repair-json.md`: `{{ORIGINAL_PROMPT}}`, `{{PARSE_ERROR}}`, `{{PREVIOUS_RESPONSE}}`; invoked after a response fails to parse as JSON
- `llm/prompts/cvgen/cv-repair-length.md`: `{{ORIGINAL_PROMPT}}`, `{{PREVIOUS_RESPONSE}}`, `{{PAGE_COUNT}}`, `{{MAX_PAGES}}`; invoked after a validated, rendered worksheet exceeds `max_pages`
- `llm/prompts/runtime/no-tools.md` (system prompt, claude only)

## Notes
- Output must be below `output/` (`childOf`), and a report is mandatory unless `--without-report` is given.
- One CV draft per output folder: `withOutputLock` (artifact `cv`) fails fast while a live owner holds the lock, reclaims a lock whose owner is gone, and removes only its own lock. A letter draft for the same folder holds its own lock and may run at the same time.
- The PDF render is spawned with `windowsHide`, so no console window appears when the dashboard runs this launcher in the background.
- Progress is reported to the dashboard task registry through `reportPhase`: drafting the worksheet, repairing it after a failure (shown as attempt `n+1`) and rendering the PDF. Runs started from a terminal have no task record and reporting is a no-op.
- Worker runs in a fresh `logs/workers/career-cv-worker-*` folder with API keys stripped (`subscriptionEnv`), no tools, no session persistence; the login check requires a subscription login.
- The answer must be JSON that preserves the worksheet keys exactly (`validateAnswer`), then `adapt` maps slot keys to catalog entries; titles, employers and dates never come from the model.
- One run is the first call plus `max_repairs` retries (default 2), a single budget shared by every failure class. Each retry carries whatever correction its failure allows, and the loop stops at the first answer that parses, validates, renders and fits `max_pages`:
  - a `CVWorksheetValidationError` sends `cv-repair.md` with the original rendered prompt (compact CV included once), the previous answer in full, path/reason pairs and the failed block; the worker returns only the fixed block, which `mergeRepair` splices into the previous answer so passing sections never change (`repairs` entry `validation`). Later attempts, including a JSON repair of a broken block, keep merging into that answer;
  - a `SyntaxError` from `parseAnswer` sends `cv-repair-json.md` with the parser message and the previous response verbatim (`repairs` entry `json`);
  - a `CVPageBudgetError` — the answer validated and rendered, but `generate-pdf.mjs`'s reported page count exceeds `max_pages` — sends `cv-repair-length.md` with the full previous (over-length) answer and the page count; the worker returns a full revised worksheet, which replaces the previous answer outright, not merged (`repairs` entry `length`). `base`/`pending` are cleared on every successful `validateAnswer`, so a length repair's full answer is never merged into stale validation state;
  - a CLI or transport failure has nothing to target, so the same input is re-run (`repairs` entry `rerun`).
- `parseAnswer` unwraps a Markdown code fence before parsing, so a fenced worksheet never costs a repair call.
- `validateAnswer` reports every detectable issue with a JSON path, a validation repair returns only the failed block, and a JSON repair returns the same object it was given (worksheet or block). The run fails only once the budget is spent, with the last failure's message — a CV that cannot be brought within `max_pages` inside the budget fails the run rather than shipping over length.
- Page count comes from `generate-pdf.mjs`'s `📊 Pages: N` stdout line (an approximate PDF-structure count, parsed with a regex — no PDF-page-count tool is invoked separately); rendering happens once per attempt, inside the same retry loop as worksheet validation, so `rendered/worksheet-response.json`, `.html` and `.pdf` reflect whichever attempt is currently running.
- Success prints `rendered-needs-visual-review`; console output and `draft-run.json` record `attempts`, `repairs` (ordered kinds) and `validation_repair_attempted`. Failures write `draft-run.json` with `status: failed` and the same counters, and keep the run folder.
