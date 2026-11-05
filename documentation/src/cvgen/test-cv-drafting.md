# src/cvgen/test-cv-drafting.mjs

**Authority:** [src/cvgen/test-cv-drafting.mjs](../../../src/cvgen/test-cv-drafting.mjs).

Checks profile-derived candidate identity and filename, letter framing, exclusive per-artifact output locks (a second CV draft is refused while a letter draft for the same folder runs alongside), lock release and numeric job-ID rejection.

## Run

`node src/cvgen/test-cv-drafting.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Creates a temporary profile and drafting archive; rejects an invalid ID before database access. Imports `_cv-drafting.mjs` and Node assertions/filesystem helpers; does not exercise a real job lookup or CLI provider.


Customization extraction preserves every paragraph until the next lettered section (or EOF), supports current E) and historical E. headings, and returns an explicit fallback when absent. Regression fixtures cover LF and CRLF reports.
