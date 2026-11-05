# llm/prompts/cvgen/cv-repair-length.md

**Kind:** worker prompt (CV page-budget repair retry; no tools)

**Purpose:** Gives a fresh drafting worker the full original rendered CV instructions (which
already contain the compact CV, so it is not repeated), the previous validated-and-rendered
worksheet in full, and the page count the render came out to against the configured budget. It
asks for **a full revised worksheet**, not a block — unlike `cv-repair.md`, no single JSON path
is at fault, since page length is a property of the whole rendered document. It instructs the
worker to cut length rather than reword, and forbids restoring anything the customization plan
or original instructions said to trim.

**Substituted by:** `src/cvgen/draft-cv.mjs`, after a response parses, passes `validateAnswer`
and renders, but `generate-pdf.mjs`'s reported page count exceeds `max_pages`
(`config/cv-drafting.json`, default 2, range 1–4). The rendered prompt is archived as
`repair-<n>-context.md`; this source prompt is archived as `repair-prompt-length.md`.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{ORIGINAL_PROMPT}}` | the fully rendered `cv-worksheet.md` prompt used for the first call, compact CV included |
| `{{PREVIOUS_RESPONSE}}` | the previous full, validated answer, pretty-printed JSON |
| `{{PAGE_COUNT}}` | the page count `generate-pdf.mjs` reported for that answer's render |
| `{{MAX_PAGES}}` | the configured page budget |

**Expected response:** one JSON object with the same keys and nesting as the worksheet (every
experience/project/skill key present, with an empty array or string for anything dropped
entirely). `parseAnswer` parses it; because no `base` is carried forward for a page-budget
failure (`draft-cv.mjs` clears `base`/`pending` on every successful `validateAnswer`), the parsed
response is used as the next candidate answer directly, not merged with `mergeRepair`. It is then
re-validated by `validateAnswer` and re-rendered; if it still exceeds `max_pages`, that consumes
another of the run's `max_repairs` attempts (`repairs` entry `length`), and the run fails once the
budget is spent rather than shipping a CV over the page limit.
