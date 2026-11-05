# src/scan/test-workable-search.mjs

**Authority:** [src/scan/test-workable-search.mjs](../../../src/scan/test-workable-search.mjs).

Checks full-JD section assembly, invalid/closed results, Canadian geography, pagination, deduplication, page caps, repeated tokens and immediate HTTP-failure handling.

## Run

`node src/scan/test-workable-search.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Imports the Workable-search provider and normalizer; injects fake `getJson` responses. Assertions use fixture URLs without contacting them; no filesystem or database writes.

