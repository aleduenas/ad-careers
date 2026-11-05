# llm/prompts/eval/evaluate.md

**Kind:** worker prompt (evaluation, the scoring step; no tools)

**Purpose:** Produces the complete evaluation worksheet for one job: eight dimension scores
with evidence, role summary, requirement comparison, level and strategy, advertised
compensation band, five CV changes, posting legitimacy and ATS keywords. It receives the
rubric, the compact candidate facts, the targeting summary, the JD, the filtered market
evidence and prior scan sightings, and must not research further or invent facts.

**Substituted by:** `src/eval/evaluate-jobs.mjs` via `renderPrompt(root,'eval/evaluate.md',...)`
after the gate returned PASS and both research steps finished, sent through `invoke()` with
the evaluation model (`*_model`) and `research=false`. `--smoke-evaluation` renders it with
synthetic values.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{SCORING_RUBRIC}}` | `llm/prompts/eval/scoring.md`, whole file (snapshot in `state.sources`) |
| `{{CANDIDATE_FACTS}}` | `llm/compacted/cv-compact.md` (snapshot) |
| `{{TARGETING}}` | `llm/compacted/candidate-targeting.md` (snapshot) |
| `{{COMPANY}}`, `{{ROLE}}` | `jobs.company`, `jobs.role` |
| `{{DATE}}` | run date `YYYY-MM-DD` |
| `{{JOB_DESCRIPTION}}` | `job_descriptions.content` |
| `{{MARKET_SALARY_CONTEXT}}` | currency-bearing paragraphs from `market-research.md`, a fixed sentence when the JD advertises a band, or `No numeric salary benchmark was found.` |
| `{{SCAN_HISTORY}}` | up to 30 `scan_history` rows for the same company and title or URL, tab-joined, or `No prior sightings recorded.` |

**Expected response:** the JSON worksheet. `invoke()` checks `sameShape` (arrays may vary in
length), then `evaluationDecode(dimensions, research)` in `src/eval/_evaluation-worksheet.mjs`
rebuilds the report blocks: scores looked up by rubric dimension name; `requirements` 1 to 12
rows and at most 500 words; `cv_changes` 5 to 6; `keywords` 15 to 22; Blocks A to F rendered
as Markdown tables. `validateEvaluation` in `src/eval/_evaluation-cli.mjs` then checks the
legitimacy enum, non-empty verdict and band, exactly eight ordered scores in 1 to 5, six
non-empty blocks without `## ` headings, and the keyword count. `render()` computes the
weighted score from `scoring.md` weights, clamps to 1 to 5, and writes the report that
`publishEvaluation` (`src/lib/_job-workflows.mjs`) commits through `complete_evaluation`.

**Notes:**

- The launcher, not the model, fills the `market research`, `employer research` (Block D) and
  `hiring signals` (Block F) rows from the research results; `UNAVAILABLE` when absent.
- `comp_and_demand.band` is the raw advertised text kept for the report body (Block D); the
  `**Compensation band:**` header line the dashboard reads is instead `formatCompensation()`
  in `src/eval/_evaluation-worksheet.mjs` applied to `band_min`/`band_max`/`band_currency`
  (plain-digit ANNUAL restatements of `band`: hourly x stated weekly hours x 52, defaulting to 2,080 hours; weekly x 52; biweekly x 26; monthly x 12; estimates annualized the same way; `band` keeps the exact advertised text) or, when those are UNKNOWN, `estimate_min`/`estimate_max`
  (a required market-estimated range when `band` is UNKNOWN). Missing estimates fail
  validation and trigger repair instead of publishing an evaluation. It always renders as
  `$X - $Y`, `$X - $Y USD` when `band_currency` is USD, or `$X - $Y estimated` when falling
  back to the estimate — never CAD, base-pay/TC wording, or other free text. `role_summary.archetype`,
  `summary`, `location` become the table rows the dashboard reads (`LoadReportSummary` in
  `dashboard/internal/data/career.go`). Renaming any of these keys breaks the dashboard preview.
- Validation tolerances are deliberately looser than the prompt targets (the code comments say
  so): prompt asks for at most 10 requirement rows, exactly five CV changes and 15 to 20
  keywords; the validators accept 12, 5 to 6 and 15 to 22.
- The run snapshots every source file and refuses to publish if any changed mid-run
  (`Inputs changed; start a new run`).
- Input index: [`llm/prompts/eval/INDEX.md`](../../../../llm/prompts/eval/INDEX.md).
