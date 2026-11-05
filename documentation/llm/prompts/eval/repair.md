# llm/prompts/eval/repair.md

**Kind:** worker prompt (evaluation, correction suffix)

**Purpose:** Asks the model to fix an invalid worksheet without adding new evidence, dates or
tool use. It is never sent alone: after a validation failure the launcher appends the rendered
repair text to the original prompt and resends the whole thing, so the worker sees the task,
the errors and its own previous answer(s).

**Substituted by:** `invoke()` in `src/eval/_evaluation-cli.mjs`, via
`renderPrompt(root,'eval/repair.md',...)`, for every retry up to `config.max_repairs`
(0 to 3, default 2). The concatenated prompt of each attempt is archived as
`<phase>-<timestamp>-<attempt>.prompt.txt` in the run folder.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{VALIDATION_ERRORS}}` | the thrown error message from `sameShape`, the decoder or the validator |
| `{{PREVIOUS_RESPONSES}}` | the last raw answer; for research phases, every answer so far joined by `--- saved response ---` so partially good sections are not lost |

**Expected response:** the same worksheet as the phase being repaired (gate, research or
evaluation); the same validators run again. If the last attempt still fails and a research
phase saved partial sections, the launcher returns those with a reason prefixed
`Partial evidence preserved after worksheet errors:` instead of failing.

**Notes:**

- The prompt applies to all three worksheet shapes; it does not know which one it is fixing.
- The repair preserves JSON keys/order and uses NONE for absent textual evidence; required numeric types remain unchanged.
- Input index: [`llm/prompts/eval/INDEX.md`](../../../../llm/prompts/eval/INDEX.md).
