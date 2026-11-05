# llm/prompts/cvgen/cv-worksheet.md

**Kind:** worker prompt (CV tailoring only; no tools)

**Purpose:** Asks the worker to tailor the candidate's CV to one JD by filling a JSON worksheet:
a summary, core competencies, bullet arrays per experience slot, one description per project
slot and skill arrays per category. The worksheet keys are the contract; titles, employers and
dates never come from the model. It has no cover-letter field and never receives the letter
reference paragraphs: the letter is always a separate call through `cover-letter-worksheet.md`,
because one worker drafting both overfit the letter to the CV and invented facts.

**Substituted by:** `src/cvgen/draft-cv.mjs` through `renderPrompt`. The rendered prompt is
archived as `cli-context.md` in `logs/drafting/runs/<run-id>/` next to copies of the sources.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{WRITING_STYLE}}` | `llm/prompts/cvgen/writing-style-guide.txt` |
| `{{JOB_DESCRIPTION}}` | `job_descriptions.content` via `resolveJob` (`--job=ID`), or the `--jd` file |
| `{{CV_CUSTOMIZATION_CONTEXT}}` | the `## E) Customization Plan` section of the job's evaluation report (`jobs.report_path`), or a fallback sentence |
| `{{CANDIDATE_CV}}` | `llm/compacted/cv-compact.md` |

**Expected response:** the JSON object between the `WORKSHEET_JSON_START/END` markers.
`parseWorksheet` (`src/cvgen/_cv-worksheet.mjs`) extracts the template; `validateAnswer` restores worksheet key order and drops stray keys
(`normalizeAnswer`), then checks that every key is present, a 45 to 75 word summary, 6 to 8 competencies of at most three words,
experience values as arrays of plain text (first three slots 2 to 5 bullets, later slots at
most 4, not all three required slots at 5), exactly three non-empty projects and skill items of
at most three words; a `cover_letter` key the worker adds anyway is a stray key and is dropped. `adapt` then
maps each experience and project key to the `<!-- slot: name -->` marker in `config/cv.md`
through `loadCatalog` (`src/cvgen/_cv-content.mjs`) and `renderHTML` produces the PDF source.

**Notes:**

- The worksheet asks for 3-5 required-role bullets while the validator accepts 2-5, a deliberate tolerance so a 2-bullet role does not trigger a repair. They agree on 45-75 summary words, exactly 3 projects and at most 3 words per competency or skill item. The worksheet gives format examples and bans ampersands and parenthetical lists in those items because the validator counts whitespace-separated words.
- Slot names form the literal response contract; actual candidate facts are private inputs. Adding or renaming a project requires matching the worksheet project keys to the `<!-- slot: name -->` markers in `config/cv.md` and keeping its private compact twin in sync. The validator and adapter read the worksheet dynamically; the live-catalog parity test checks that the slot sets match.
- Both drafting launchers use renderPrompt, whose function replacement preserves literal dollar-sign sequences in supplied text.
- If a parsed response fails validation, `cv-repair.md` receives this rendered prompt in full,
  the previous response, exact path-specific failures and the failed block. The repair returns
  only the fixed block, which is merged into the previous response before revalidation.

Competency items are limited to three whitespace-separated words; the prompt explicitly asks the worker to check each item, matching the validator.
