# src/cvgen/test-cv-worksheet.mjs

**Authority:** [src/cvgen/test-cv-worksheet.mjs](../../../src/cvgen/test-cv-worksheet.mjs).

Checks the live prompt worksheet (including that it has no `cover_letter` field), malformed answers, length/bullet rules, that a stray `cover_letter` is dropped, two-to-three-project bounds, slot adaptation and catalog reorder safety.

## Run

`node src/cvgen/test-cv-worksheet.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Reads the live CV worksheet and uses synthetic answers/catalog entries. It also verifies that multiple validation failures carry exact JSON paths and that repair evidence contains only the implicated fields, and that `mergeRepair` splices a repaired block in without touching passing sections, keeps a partial block and re-asks only for the omitted path, and replaces wholesale only a non-object response. It checks that key order and stray keys are normalized without an issue and that a renamed key or malformed section is reported at its own path, never as `$`. It checks that `CVPageBudgetError` carries the full over-length answer (not a JSON-path fragment) plus `pageCount`/`maxPages`, and its message's singular/plural page wording. If private `config/cv.md` exists, it checks its slot sets against worksheet keys regardless of catalog order. Imports `_cv-worksheet.mjs`, `_cv-content.mjs` and `root.mjs`; no writes or model calls.
