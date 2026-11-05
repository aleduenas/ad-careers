# src/cvgen/test-cv-content.mjs

**Authority:** [src/cvgen/test-cv-content.mjs](../../../src/cvgen/test-cv-content.mjs).

Exercises catalog parsing, required headings, slot markers, education text, contact rendering, HTML escaping, repository badges and omitted sections.

## Run

`node src/cvgen/test-cv-content.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Uses synthetic files in an OS temporary directory and the live structured HTML template. `--smoke-html` additionally writes `logs/tests/cv-render-smoke/cv.html`. Imports `_cv-content.mjs` and Node assertions/filesystem helpers; no database or model calls.

