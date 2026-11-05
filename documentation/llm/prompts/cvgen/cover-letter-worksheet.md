# llm/prompts/cvgen/cover-letter-worksheet.md

**Kind:** worker prompt (cover letter only; no tools)

**Purpose:** Asks the worker for the plain-text body of a tailored cover letter built from the
reference paragraphs, the writing style guide and the compact CV, with only CV-supported claims
and relevant ATS terms. The greeting and sign-off are added by the script, so the model returns
paragraphs only.

**Substituted by:** `src/cvgen/draft-cover-letter.mjs` through `renderPrompt`, always as its own
call: the dashboard's **CV + cover letter** action starts this launcher and `draft-cv.mjs` as two
separate tasks, and the CV worksheet has no letter field. The rendered prompt is archived as
`cli-context.md` in `logs/drafting/runs/<timestamp>-letter-<uuid>/`.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{WRITING_STYLE}}` | `llm/prompts/cvgen/writing-style-guide.txt` |
| `{{COVER_LETTER_SAMPLES}}` | `llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt` |
| `{{JOB_DESCRIPTION}}` | `job_descriptions.content` via `resolveJob` (`--job=ID`), or the `--jd` file |
| `{{CANDIDATE_CV}}` | `llm/compacted/cv-compact.md` |

**Expected response:** plain text, no JSON. The only check is that the trimmed response is
non-empty; it is saved as `response.md` in the run folder and wrapped by `wrapCoverLetter`
(`src/cvgen/_cv-drafting.mjs`) with a fixed greeting and a sign-off using `candidate.full_name`
from `config/profile.yml`, then written to `output/<company>/<role>--<job-id>/cover-letter.md`. The
dashboard's `p` key later renders that edited file to PDF via
`src/cvgen/publish-cover-letter.mjs`.

**Notes:**

- Requires an evaluation report unless `--without-report` is passed; output must sit under
  `output/`; one letter draft per output folder at a time (`withOutputLock`, artifact `letter`),
  independent of any CV draft for the same job.
- Observation: no word-count or "no greeting" check is applied in code; a response that
  includes a salutation is written as-is.
- Observation: the file is named a worksheet but the contract is free text, not a JSON
  worksheet with markers.
