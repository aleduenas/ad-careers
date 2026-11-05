# src/eval/_evaluation-worksheet.mjs

**Kind:** shared module
**Purpose:** Decoders that turn the literal JSON worksheets returned by the worker (gate, research, evaluation) into the plain values `render` in `_evaluation-cli.mjs` expects. Nothing here builds prompt text or output shape; the `.md` prompt files own the worksheet shape and this file only converts and bounds-checks the answers.

## Run
Not runnable; imported by other modules.

## Reads
- none (pure functions over the parsed JSON answer)

## Writes
- none

## Imports
- none

## Used by
- `src/eval/evaluate-jobs.mjs` (`passthrough`, `researchDecode`, `evaluationDecode`)
- `src/eval/test-evaluation-worksheet.mjs` (also `validEvidenceDate`)

## Counterpart prompt(s)
- none (decodes the worksheets of `llm/prompts/eval/gate.md`, `market-research.md`, `company-research.md` and `evaluate.md`; the launcher page lists the placeholders)

## Notes
- `validEvidenceDate`: accepts `UNKNOWN`, `UNAVAILABLE`, an optional `accessed ` prefix, and `YYYY`, `YYYY-MM` or `YYYY-MM-DD` with real calendar bounds (1900-2100, valid day for the month).
- `passthrough`: gate answers are used as-is (`decision`, `reason`, `location`).
- `researchDecode(sections)(raw, strict)`: for each requested section flattens `evidence[]` into "fact (Source date/access: date; url)" paragraphs; facts equal to `NONE` are dropped; an item with a bad date or non-`http(s)` URL is an error in strict mode and is silently dropped otherwise; an empty section becomes `null`; `reason` comes from `raw.limitations`.
- `evaluationDecode(dimensions, research)`: maps `raw.scores[dimension]` in rubric order, builds Markdown tables for blocks A-F (role summary, requirements, level and strategy, comp and demand, customization plan, posting legitimacy) and injects the research strings (`market`, `employer`, `hiring`, defaulting to `UNAVAILABLE`) into blocks D and F. Bounds: 1-12 requirement rows each with requirement/evidence/match (target 1-10), requirements text under 500 words, 5-6 `cv_changes` (target 5), 15-22 keywords (target 15-20). An advertised band requires numeric `band_min`/`band_max`; an `UNKNOWN` band requires numeric `estimate_min`/`estimate_max`, causing worksheet repair rather than publishing a report without dashboard compensation. `compensationBand` comes from `formatCompensation(raw.comp_and_demand)`, not the raw `band` text (that raw text stays in block D only). Returns `{legitimacy, note (from verdict), compensationBand, scores, blocks, keywords}`.
- `formatCompensation({band_min, band_max, band_currency, estimate_min, estimate_max})`: the single place that turns worksheet compensation fields into the one display string the dashboard shows. Parses each field as a plain number (stripping any stray symbols/commas the model added). The prompt requires annual amounts; as a safety net any parsed amount under 1,000 is treated as an unconverted hourly rate and multiplied by 2,080 (40 hours x 52 weeks) before display; a valid `band_min`/`band_max` pair renders `$X - $Y`, with ` USD` appended only when `band_currency` is `USD` (never CAD or other currency text). Otherwise falls back to a valid `estimate_min`/`estimate_max` pair, rendered `$X - $Y estimated`. The decoder rejects a worksheet before publication when the required pair is absent.
- Table cells strip `|` and newlines so a quoted multi-line fact cannot break the Markdown table.
