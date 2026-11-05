# llm/prompts/cvgen/cv-repair.md

**Kind:** worker prompt (CV validation-repair retry; no tools)

**Purpose:** Gives a fresh drafting worker the full original rendered CV instructions (which
already contain the compact CV, so it is not repeated), the previous response in full, exact
path-specific validation failures and the failed block: only the implicated JSON sections,
nested as in the worksheet. It asks for **only the fixed block**, not the whole worksheet. The
prompt states that a previous agent messed up and prohibits tools, searches, extra facts and
commentary.

**Substituted by:** `src/cvgen/draft-cv.mjs`, after a response parses as JSON but
`validateAnswer` throws `CVWorksheetValidationError`. A response that does not parse at all is
repaired with `cv-repair-json.md` instead. The rendered prompt is archived as
`repair-<n>-context.md`; this source prompt is archived as `repair-prompt.md`.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{ORIGINAL_PROMPT}}` | the fully rendered `cv-worksheet.md` prompt used for the first call, compact CV included |
| `{{PREVIOUS_RESPONSE}}` | the previous full answer (after any earlier merge), pretty-printed JSON |
| `{{VALIDATION_ERRORS}}` | newline-separated JSON paths and exact validator reasons |
| `{{AFFECTED_JSON}}` | JSON containing only invalid fields/sections, nested as in the worksheet; a missing key appears as `null`. Only a response that was not a JSON object at all is included whole |

**Expected response:** one JSON object with the same keys and nesting as `{{AFFECTED_JSON}}`.
`parseAnswer` parses it and `mergeRepair` (`src/cvgen/_cv-worksheet.mjs`) splices each issue path
into the previous answer, so sections that already passed are carried over unchanged and cannot
regress. The merged answer is archived as `repair-<n>-merged.json` and validated by the same
`validateAnswer` call. A path the block omits keeps its previous value, so validation reports
just that path again with its real reason and the next repair asks only for it. Wrong key order
and stray keys never reach a repair (`normalizeAnswer` fixes them), and a renamed or missing
key is reported at its own path, so no failure asks for the whole worksheet except a response
that was not a JSON object at all. A
repair that fails again consumes one of the run's `max_repairs` attempts and is itself repaired
with whichever prompt matches its new failure; the run fails once the budget is spent.
