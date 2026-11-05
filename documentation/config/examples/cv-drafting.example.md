# config/examples/cv-drafting.example.json

**Authority:** [config/examples/cv-drafting.example.json](../../../config/examples/cv-drafting.example.json).

Drafting runtime example.

## Run and callers

Copy to config/cv-drafting.json. Select an authenticated provider and authorized models; set codex_model explicitly before choosing Codex.

## Inputs

Includes command names, model settings, timeout, archive root, `max_repairs` (retries after the first worker call; default 2, range 0–3, shared by both drafting launchers) and `max_pages` (rendered-PDF page budget enforced by `draft-cv.mjs`; default 2, range 1–4; a render over budget consumes one of the same `max_repairs` retries via `llm/prompts/cvgen/cv-repair-length.md`). Values mirror the current launcher contract rather than prescribing a model migration.

## Behavior and outputs

Read by both drafting launchers; evaluation borrows executable paths. `src/lib/cli-runtime.mjs` executes the supplied settings. Private absolute executable paths belong only in the copied config.
