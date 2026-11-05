# llm/prompts/cvgen/cv-repair-json.md

**Kind:** worker prompt (CV malformed-JSON repair retry; no tools)

**Purpose:** Gives a fresh drafting worker the full original rendered CV instructions, the exact
parser message, and the previous response verbatim, then asks for the same worksheet re-emitted
as strictly valid JSON. It lists the syntax rules that actually break real runs (a literal
newline inside a string value, unescaped quotes/backslashes/tabs, single quotes, trailing
commas) and tells the worker to reuse the previous wording wherever the original instructions
allow, because the content is normally correct and only its syntax is broken. Tools, searches,
extra facts, fences and commentary are prohibited.

**Substituted by:** `src/cvgen/draft-cv.mjs`, after a response fails `parseAnswer` with a
`SyntaxError`. Unlike the validation repair this one repeats the previous response in full: the
broken text is the thing being fixed, so nothing can be isolated from it. The rendered prompt is
archived as `repair-<n>-context.md`; this source prompt is archived as `repair-prompt-json.md`.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{ORIGINAL_PROMPT}}` | the fully rendered `cv-worksheet.md` prompt used for the first call |
| `{{PARSE_ERROR}}` | the `SyntaxError` message from `parseAnswer`, including its position |
| `{{PREVIOUS_RESPONSE}}` | the previous worker response verbatim, trailing whitespace trimmed |

The compact CV is not repeated; it is already inside `{{ORIGINAL_PROMPT}}`.

**Expected response:** the same JSON object as strictly valid JSON: the complete worksheet, or
only the block when the unparseable response was itself a validation-repair block, in which
case `mergeRepair` splices it into the previous answer as usual. The result is validated by
`validateAnswer`. A repair that fails again consumes one of the run's `max_repairs` attempts and
is itself repaired with whichever prompt matches its new failure.
