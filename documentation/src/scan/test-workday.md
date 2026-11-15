# src/scan/test-workday.mjs

**Authority:** [src/scan/test-workday.mjs](../../../src/scan/test-workday.mjs).

Checks the detail pre-check through `ctx.shouldFetchContent` (`N Locations` stub treated as unknown), the stable posting URL, 429/timeout retry with backoff (1.5 s, 4 s via an injectable `ctx.sleep`), omission plus the per-company summary line for postings whose detail stays unavailable, and `N Locations` becoming `''` after detail. Also checks Workday all-job pagination, merged/deduplicated locations and rejection of incomplete results beyond the provider cap.

## Run

`node src/scan/test-workday.mjs`.

Discovered automatically by `src/test-all.mjs`; failures exit nonzero.

## Inputs, dependencies and side effects

Imports the Workday provider and injects `postJson`/`getJson` fixtures. No live requests, database access or persistent writes.

