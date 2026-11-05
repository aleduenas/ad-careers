# src/cvgen/draft-cover-letter.mjs

**Kind:** launcher
**Purpose:** Drafts a standalone cover letter for one job with an isolated subscription CLI call, retried up to `max_repairs` times on a CLI or empty-response failure. It fills the cover-letter worksheet prompt with the cached JD, the compact CV, the paragraph samples and the writing style guide, wraps the worker's plain-text answer in the salutation and sign-off, and writes `output/<company>/<role>--<job-id>/cover-letter.md` for review. It is the only way a letter is drafted: the CV worker (`draft-cv.mjs`) never writes one, because a single call drafting both overfit the letter to the CV and invented facts.

## Run
`node src/cvgen/draft-cover-letter.mjs --job=ID [--provider=claude|codex] [--dry-run] [--prepare-only]`
- `--job=ID`: permanent job ID (report, JD and output folder resolved from PostgreSQL). Alternative: `--jd=path --report=path --out=output/company/role`, with `--without-report` to skip the report requirement (needs prior user authorization).
- `--provider`: `claude` or `codex` (default from `config/cv-drafting.json`).
- `--dry-run`: print provider, run directory, prompt path and selection; writes nothing.
- `--prepare-only`: write the run folder with the rendered context; no login check, no CLI call.
- Run directly; `draft-cv.mjs` no longer forwards to it and rejects `--letter-only`.

## Reads
- `config/cv-drafting.json` (`default_provider`, `claude_command`, `codex_command`, `claude_model`, `codex_model`, `claude_effort`, `timeout_ms`, `drafting_root`, `max_repairs` — default 2, range 0–3)
- `llm/prompts/cvgen/cover-letter-worksheet.md`, `llm/prompts/cvgen/writing-style-guide.txt`, `llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt`, `llm/prompts/runtime/no-tools.md` (system prompt via `cliSpec`)
- `llm/compacted/cv-compact.md`; `config/profile.yml` (`candidate.full_name` for the sign-off)
- PostgreSQL: `jobs` (`getJob`, requires `report_path`), `job_descriptions` (`getJD`); `DATABASE_URL` through `src/lib/_database.mjs`

## Writes
- `<drafting_root>/runs/<timestamp>-letter-<uuid>/`: `cv.md`, `job-description.md`, `cover-letter-samples.md`, `worksheet.md`, `writing-style-guide.txt`, `cli-context.md`, `stderr.log`, `retry-<n>-stderr.log` for each retry, `response.md`
- `<drafting_root>/locks/<out-slug>.letter.lock` during the call (separate from the CV's lock, so both can run for one job at once)
- `output/<company>/<role>--<job-id>/cover-letter.md` ("Dear hiring team," + body + "Thank you," + name)
- `logs/token-usage/*.json` when debug logging is enabled; no PostgreSQL writes

## Imports
- `src/lib/_token-debug.mjs` (`logTokenUsage`)
- `src/lib/cli-runtime.mjs` (`draftingRoot`, `temporaryWorker`, `childOf`, `cliSpec`, `processRun`, `checkLogin`)
- `src/cvgen/_cv-drafting.mjs` (`resolveJob`, `wrapCoverLetter`, `candidateName`, `withOutputLock`)
- `src/lib/root.mjs`
- `src/lib/_task-status.mjs` (`reportPhase`)

## Used by
- `dashboard/workflow.go` (action `letter`, and the `letter` half of `both`; always `--job=N`), `dashboard/workflow_test.go`
- `src/cvgen/test-drafting-integration.mjs`

## Counterpart prompt(s)
- `llm/prompts/cvgen/cover-letter-worksheet.md`: `{{JOB_DESCRIPTION}}`, `{{CANDIDATE_CV}}`, `{{COVER_LETTER_SAMPLES}}`, `{{WRITING_STYLE}}` (all source-template occurrences substituted once by `renderPrompt`; missing template values abort; inserted text remains literal)
- `llm/prompts/runtime/no-tools.md` (system prompt, claude only)

## Notes
- Output must be below `output/`; the report is mandatory unless `--without-report`.
- Unlike the CV path, the response is free text, not JSON: the only check is that it is non-empty. Word-count and style rules are enforced by the prompt, not by code, so the result is `drafted-needs-review`.
- A failure here is always a CLI, transport or empty-response failure with nothing to correct, so the same input is re-run up to `max_repairs` times after the first call. Each attempt is reported to the dashboard as a retry and keeps its own stderr log; the printed result records `attempts`.
- The letter body written to `cover-letter.md` is the raw response (trimmed by `wrapCoverLetter`); the PDF is produced separately by `src/cvgen/publish-cover-letter.mjs`.
