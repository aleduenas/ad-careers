# llm

Everything an LLM *worker* reads when it does the project's work: evaluating a job, writing a CV or
letter, extracting a posting. AI *development* sessions read `AGENTS.md`, never this folder, and
nothing here contains repository-maintenance instructions. This README is the whole documentation
for this branch.

| Folder | Contents | Rendered by |
|---|---|---|
| `prompts/eval/` | `gate`, `company-research`, `market-research`, `scoring` (the rubric), `evaluate`, `repair`; `INDEX.md` maps every placeholder to its runtime source | `src/eval/evaluate-jobs.mjs`, `src/eval/_evaluation-cli.mjs` |
| `prompts/cvgen/` | `cv-worksheet`, three CV repair prompts (`cv-repair` for validation, `cv-repair-json`, `cv-repair-length`), `cover-letter-worksheet`, plus the private `writing-style-guide.txt` and `cover-letter-paragraph-worksheet.txt` | `src/cvgen/draft-cv.mjs`, `draft-cover-letter.mjs` |
| `prompts/intake/` | `extract-posting`: strips page chrome from a fetched posting, returns company, role, location and the verbatim description | `src/server/intake-extract.mjs` |
| `prompts/runtime/` | `no-tools`, `research`: provider system prompts | `src/lib/cli-runtime.mjs` |
| `compacted/` | (private) `cv-compact.md`, `candidate-targeting.md` | both launchers |

## The contract between a launcher and its prompt

- Launcher and prompt are a pair. A placeholder (`{{UPPERCASE}}`) or response key renamed in one is
  renamed in the other and in its validator. Launchers supply only the named placeholders and reject
  any that stay unresolved (`src/lib/_prompt-templates.mjs`).
- A worker's JSON worksheet (the cover letter returns plain text) is literal text in its prompt, between `WORKSHEET_JSON_START` and
  `WORKSHEET_JSON_END`. The launcher checks that the answer has the same keys in the same order
  (`sameShape`) and then runs the stage's validator; it does not define the shape in code. The CV
  validator restores key order and drops stray keys itself and reports only missing ones.
- Workers return data, never formatting: the launcher renders the report and the CV, and computes every
  score. Prompt wording that has a numeric limit (word counts, counts of items) is enforced by the
  validator, so changing the number means changing both.
- Repair prompts are appended or sent as a fresh call after a validation failure; they receive the
  previous answer verbatim and the exact failing paths.
- Evidence, not sources: each evaluation run snapshots every prompt it used under
  `logs/evaluation/<run>/prompt-sources/`, and each drafting run copies its worksheet, repair prompts
  and style guide into `logs/drafting/runs/<run>/`. Edit the files here, not those copies.
- Prompts contain no candidate facts. Facts arrive at run time from `llm/compacted/`; the two private
  style inputs in `prompts/cvgen/` are gitignored.
- No tool or web access is granted beyond what the prompt's runtime system prompt allows: research
  workers get web search; everything else runs without tools. Research prompts state a search budget
  (four searches, four fetches) as an instruction, not a hard quota.

## Scoring rubric

`prompts/eval/scoring.md` is the rubric: eight weighted dimensions with 1 to 5 anchors. The launcher
parses names and weights from its table when it loads and refuses to run unless the weights sum to 100;
`src/eval/test-evaluation-cli.mjs` asserts the same. To change scoring, edit that one file.

- Location is a pass/fail gate (`gate.md`: PASS, FAIL or REVIEW; ambiguity is REVIEW, never a guess), not
  a scored dimension. The years-of-experience gap is computed from the CV's work-history dates at
  evaluation time, never from a stored figure.
- When rebalancing, redistribute removed weight proportionally across the remaining dimensions and
  correct rounding on one dimension so the total is exactly 100. Per-gap consistency rulings belong in
  the candidate targeting file, not in the rubric.
- Score is information for the user; it is never a gate on any action.

## Candidate inputs and their compact twins

Workers get token-cheap versions of two private documents; the full versions live in `config/`.

| Compact (here) | Full | Inserted as |
|---|---|---|
| `compacted/cv-compact.md` | `config/cv.md` | `{{CANDIDATE_FACTS}}` (evaluate), `{{CANDIDATE_CV}}` (both cvgen worksheets) |
| `compacted/candidate-targeting.md` | `config/profile.md` | `{{TARGETING}}` (evaluate) |

Sync rule: a change to facts, targeting, compensation, location, education framing or rulings is made in
both files of a pair in the same edit; both carry a sync note. No script checks this. The evaluator reads
both at run creation, archives them, and refuses to continue or resume a run if either changed
(`Inputs changed; start a new run`); a missing file is a hard error.
