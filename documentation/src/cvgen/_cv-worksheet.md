# src/cvgen/_cv-worksheet.mjs

**Authority:** [src/cvgen/_cv-worksheet.mjs](../../../src/cvgen/_cv-worksheet.mjs).

Parses the literal CV worksheet, validates the worker answer and adapts it by stable catalog slots.

## Inputs

`parseWorksheet(promptSource)` reads JSON between the `WORKSHEET_JSON_START/END` markers in `llm/prompts/cvgen/cv-worksheet.md`. `parseAnswer(text)` turns one worker response into the answer object, unwrapping a Markdown code fence first. `validateAnswer` accepts the answer and the worksheet. The worksheet is CV-only; the cover letter is drafted by a separate call (`draft-cover-letter.mjs`) and is never validated here.

## Outputs and behavior

`validateAnswer` first applies `normalizeAnswer` (worksheet key order, stray keys dropped at the top level and inside experience, projects and skills) and returns the normalized answer. Requires every worksheet key, reporting a missing one at its own path, a 45–75 word summary, 6–8 competencies of at most three words, required/optional role bullet limits, exactly three projects and skill items of at most three words; a `cover_letter` key the worker adds anyway is dropped as a stray key. It collects all detectable failures as `CVWorksheetValidationError.issues` entries with exact JSON paths and exposes `affected`, a minimal JSON object containing only implicated fields (the full response only when it was not a JSON object); the error also carries the normalized `answer`. `mergeRepair(previous, block, issues)` returns a copy of the previous answer with each issue path replaced from a validation-repair block; a path the block omits keeps its previous value, and only a non-object (`$`) response is replaced by the block wholesale. `adapt` maps entries using `<!-- slot: key -->`, rejecting missing or duplicate slots.

`CVPageBudgetError(pageCount, maxPages, answer)` is thrown by the caller (`draft-cv.mjs`), not by anything in this module — this module only defines it — after a `validateAnswer`-passed answer renders to more pages than the configured budget. Unlike `CVWorksheetValidationError`, no JSON path is at fault, so it carries the full validated `answer` rather than an `affected` fragment; the caller's repair prompt (`cv-repair-length.md`) asks for a full revised worksheet, which replaces the previous answer outright instead of being spliced in by `mergeRepair`.

## Dependencies and callers

No imports. Used by `draft-cv.mjs` and `test-cv-worksheet.mjs`; catalog input comes from `_cv-content.mjs`. The launcher uses the structured validation error to build `cv-repair.md` and `mergeRepair` to apply its block-only answer, a `SyntaxError` from `parseAnswer` to build `cv-repair-json.md`, and `CVPageBudgetError` (which it throws itself, after rendering) to build `cv-repair-length.md`. Fence unwrapping is unambiguous, so it happens in code rather than costing a repair call; every other syntax error is left to that repair. These structural checks do not prove claims are factual or copied from evidence, and page-count checking does not prove the rendered layout reads well. Adaptation survives catalog reordering; the live-config parity test compares slot sets.
