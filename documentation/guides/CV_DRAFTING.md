# CV and cover-letter drafting

The CV and the cover letter are always drafted by **separate calls with separate prompts**:

| Artifact | Launcher | Prompt | Output |
|---|---|---|---|
| CV | `node src/cvgen/draft-cv.mjs --job=ID` | `llm/prompts/cvgen/cv-worksheet.md` (JSON worksheet) | `cv-<name-slug>.pdf` |
| Cover letter | `node src/cvgen/draft-cover-letter.mjs --job=ID` | `llm/prompts/cvgen/cover-letter-worksheet.md` (plain text) | `cover-letter.md` |

One worker drafting both in a single call overfit the letter to the CV and was prone to
inventing facts, so there is no combined worksheet: the CV worksheet has no letter field, and
`draft-cv.mjs` rejects the retired `--cover-letter` and `--letter-only` flags. The dashboard's
**CV** and **Cover letter** actions run one launcher each; **CV + cover letter** starts both as
two independent background tasks, each with its own task record and log, so one can fail or be
retried without the other. Per-file detail: `documentation/src/cvgen/`.

## What the CV worker receives

The literal prompt `llm/prompts/cvgen/cv-worksheet.md` with these placeholders filled:

| Placeholder | Source |
|---|---|
| `{{CANDIDATE_CV}}` | `llm/compacted/cv-compact.md` |
| `{{JOB_DESCRIPTION}}` | the job's `job_descriptions` row (cached file under `data/jds/`) |
| `{{WRITING_STYLE}}` | `llm/prompts/cvgen/writing-style-guide.txt` (private) |
| `{{CV_CUSTOMIZATION_CONTEXT}}` | Block E ("Customization Plan") of the job's evaluation report; advisory only |

The cover-letter reference paragraphs never reach the CV worker.

The rendered context, prompt sources, style guide, JD and raw response are saved under
`logs/drafting/runs/<run-id>/` so every result is auditable. On validation failure the folder
also contains `validation-error.json`, the rendered `repair-context.md`, raw
`repair-response.json` and repair stderr. A failed repair or rendering failure leaves the run
folder with a `draft-run.json` status of `failed`.

## Validation and rendering

1. The response must contain the worksheet's keys (`src/cvgen/_cv-worksheet.mjs`,
   `validateAnswer`; key order and stray keys are fixed in code by `normalizeAnswer`, and a
   missing key is reported at its own path): a 45–75 word summary, 6–8 competencies of at most three words, 2–5
   bullets for each of the three required roles (never five for all three), at most four for
   optional roles, exactly three projects, and skill items of at most three words.
2. A run is the first call plus `max_repairs` retries (default 2, `config/cv-drafting.json`,
   range 0–3), shared by every failure class; each retry carries whatever correction its
   failure allows, and the run fails once the budget is spent.
   - **Validation failure.** Validation collects exact JSON paths and reasons. A fresh worker
     receives `llm/prompts/cvgen/cv-repair.md` with the original rendered instructions (compact
     CV included once), the previous response in full, the errors and the failed block, and
     returns only the fixed block. `mergeRepair` splices it into the previous answer, so
     sections that already passed never change; the merge is archived as
     `repair-<n>-merged.json`.
   - **Unparseable response.** A Markdown code fence is unwrapped in code (`parseAnswer`) and
     costs no call. Any other syntax error — in practice a literal newline inside a string
     value, which broke real runs — sends `llm/prompts/cvgen/cv-repair-json.md` with the
     parser message and the previous response verbatim.
   - **CLI or transport failure.** Nothing can be targeted, so the same input is re-run.
   - **Page-budget failure.** The worksheet validated and rendered, but the PDF exceeded
     `max_pages`. A fresh worker receives `llm/prompts/cvgen/cv-repair-length.md` with the full
     previous worksheet and the page count, and must return a full revised worksheet, which
     replaces the previous answer outright (no block merge).
   Every retry's response goes through the same parsing and validation. `draft-run.json` and the
   console record `attempts`, `repairs` (the ordered kinds: `json`, `validation`, `length`,
   `rerun`) and `validation_repair_attempted`.
3. `adapt()` maps the answer onto the catalog **by slot**: each worksheet key
   (`data_consulting`, `fairness_autoencoder`, …) matches the `<!-- slot: key -->` marker under
   the corresponding heading in `config/cv.md`. Titles, employers, dates, education and contact
   details always come from `config/cv.md` and `config/profile.yml`, never from the model.
   The adapter preserves slot identity when the catalog is reordered; parity tests compare slot sets. A missing or duplicate slot fails the run.
4. `renderHTML()` (`src/cvgen/_cv-content.mjs`) fills `src/cvgen/templates/cv-structured.html`;
   `src/cvgen/generate-pdf.mjs` renders it with Playwright (letter format) inside the same retry
   loop as worksheet validation. If the rendered PDF exceeds `max_pages` (`config/cv-drafting.json`,
   default 2, range 1–4), that consumes one of the run's `max_repairs` attempts: a fresh worker
   gets `llm/prompts/cvgen/cv-repair-length.md` with the full previous worksheet and the page
   count, and must return a full revised worksheet (not a block, since no single JSON path is at
   fault) that fits the budget. The run fails once the budget is spent without a render inside
   budget — a CV is never shipped over the page limit. Output:
   `output/<company>/<role>--<job-id>/cv-<candidate-name>.pdf` (name from `config/profile.yml`).
   There is still no automatic visual QA beyond page count; every draft needs a human review.

## Cover letter

`src/cvgen/draft-cover-letter.mjs` fills `llm/prompts/cvgen/cover-letter-worksheet.md` with
`{{JOB_DESCRIPTION}}`, `{{CANDIDATE_CV}}`, `{{WRITING_STYLE}}` and `{{COVER_LETTER_SAMPLES}}`
(`llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt`, private). It never sees the CV
worksheet, the CV worker's answer or the evaluation's customization plan. The worker returns a
plain-text body; a CLI failure or empty response is re-run up to `max_repairs` times. The
launcher adds the greeting and sign-off and writes `output/<company>/<role>--<job-id>/cover-letter.md`.
Edit the Markdown, then
`node src/cvgen/publish-cover-letter.mjs output/<company>/<role>--<job-id>/cover-letter.md` renders the
PDF (evidence under `logs/publishing/`).

## Locks and isolation

Each launcher takes a lock for its own artifact in the output folder
(`logs/drafting/locks/<out-slug>.cv.lock` or `.letter.lock`): a second CV draft, or a second
letter draft, for the same folder fails fast, while a CV and a letter for the same job run side
by side. Worker processes run in disposable folders under `logs/workers/`
with API-key variables stripped and session persistence, slash commands and project MCP
disabled (`src/lib/cli-runtime.mjs`).

## Diagnostics

```bash
node src/cvgen/draft-cv.mjs --doctor                 # subscription login check for both providers
node src/cvgen/draft-cv.mjs --job=123 --dry-run      # resolve inputs, write nothing
node src/cvgen/draft-cv.mjs --job=123 --prepare-only # write the run folder, no model call
```

`draft-cover-letter.mjs` takes the same `--job`, `--dry-run` and `--prepare-only` flags.
An evaluation report is required by both launchers unless `--without-report` is passed with the
user's authorization. Provider and models come from `config/cv-drafting.json`; only subscription logins
are accepted.
