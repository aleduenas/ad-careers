# src/eval/test-evaluation-worksheet.mjs

**Kind:** test
**Purpose:** Contract test proving that every worksheet field the evaluation code expects is literal JSON inside the rendered `.md` prompts, and that the decoders and validators accept valid answers and reject malformed ones. It guards the launcher/prompt pairing without calling any CLI or database.

## Run
`node src/eval/test-evaluation-worksheet.mjs` from the repository root (it uses `process.cwd()` as root). No `TEST_DATABASE_URL` needed. Discovered automatically by `src/test-all.mjs`.

## Reads
- `llm/prompts/eval/gate.md`, `market-research.md`, `company-research.md`, `evaluate.md` (rendered with synthetic values, worksheet JSON extracted)
- `llm/prompts/eval/scoring.md` indirectly (importing `_evaluation-cli.mjs` loads the rubric)

## Writes
- none

## Imports
- `src/lib/_prompt-templates.mjs` (`renderPrompt`, `extractWorksheetJSON`, `sameShape`)
- `src/eval/_evaluation-worksheet.mjs`
- `src/eval/_evaluation-cli.mjs` (`dimensions`, validators)

## Used by
- `src/test-all.mjs` (test discovery)

## Counterpart prompt(s)
- none

## Notes
- Asserts the gate worksheet keys are exactly `decision, reason, location`; missing or extra keys fail `sameShape`.
- Asserts `evaluate.md` score keys equal the rubric `dimensions` in order, the template has one example requirement row and five `cv_changes`, and no `linkedin_changes` key exists.
- Exercises the `validEvidenceDate` accept/reject lists, empty evidence arrays decoding to `null`, invalid URLs dropped in non-strict mode, and the bounds on requirements (1-12), `cv_changes` (5-6), keywords (15-22) and the 500-word requirements limit.

Prompt substitution fixtures preserve literal placeholder-looking input and replacement metacharacters, while still rejecting missing source-template values.
