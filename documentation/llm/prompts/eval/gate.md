# llm/prompts/eval/gate.md

**Kind:** worker prompt (evaluation, step 0)

**Purpose:** Decides location eligibility for one job from the cached JD alone, before any
research or scoring happens. The model returns PASS, FAIL or REVIEW plus a one-phrase work
location that the market-research prompt reuses. It runs with no tools; ambiguity must be
answered REVIEW rather than guessed.

**Substituted by:** `src/eval/evaluate-jobs.mjs`, via `renderPrompt(root,'eval/gate.md',...)`
from `src/lib/_prompt-templates.mjs`. The rendered text is written to
`logs/evaluation/<run-id>/<job-id>/gate.prompt.txt` at preparation time and re-read when the
run executes, then sent through `invoke()` in `src/eval/_evaluation-cli.mjs`.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{CACHED_JD}}` | `job_descriptions.content` for the job (`getJD` in `src/lib/_job-descriptions.mjs`), or the literal `No cached JD` |

**Expected response:** the JSON object between the `WORKSHEET_JSON_START/END` markers with
`decision`, `reason`, `location`. `invoke()` checks `sameShape` against the template, applies
the `passthrough` decoder (`src/eval/_evaluation-worksheet.mjs`) and then `validateGate`
(decision in PASS/FAIL/REVIEW, non-empty reason and location). Up to `max_repairs` retries
append `repair.md`.

**Notes:**

- Outcome mapping in the launcher: FAIL renders a stub report with status `Discarded`; a missing JD
  never calls the CLI at all (the launcher synthesizes `decision: MISSING`, status `Discarded`);
  REVIEW leaves the job Pending, stores the reason in `jobs.evaluation_error` and ends the run
  as `needs-attention` (exit code 2); PASS proceeds to research and `evaluate.md`.
- The gate is invoked with the research model configuration (`*_research_model`) but with
  `research=false`, so the `runtime/no-tools.md` system prompt applies. It is a cheap-model
  step by design.
- The decision rules (Toronto/Ontario, remote open to Canada, no relocation) are written into
  the prompt text itself; they are not read from `llm/compacted/candidate-targeting.md`.
  Observation: a change to the location policy therefore has to be made here as well as in the
  candidate documents.
- Input index: [`llm/prompts/eval/INDEX.md`](../../../../llm/prompts/eval/INDEX.md).
