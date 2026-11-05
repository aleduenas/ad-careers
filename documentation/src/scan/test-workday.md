# src/scan/test-workday.mjs

**Authority:** [src/scan/test-workday.mjs](../../../src/scan/test-workday.mjs).

Checks Workday all-job pagination, merged/deduplicated locations and rejection of incomplete results beyond the provider cap.

## Run

`node src/scan/test-workday.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Imports the Workday provider and injects `postJson`/`getJson` fixtures. No live requests, database access or persistent writes.

