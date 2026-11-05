# src/scan/test-workable.mjs

**Authority:** [src/scan/test-workable.mjs](../../../src/scan/test-workable.mjs).

Checks Workable country-directory parsing, country-feed expansion, deduplication, eligible-detail fetching, probe mode and unresolved-directory errors.

## Run

`node src/scan/test-workable.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Uses `node:test`, assertions and injected HTTP responses for the Workable provider. No live requests or persistent writes.

