# src/scan/test-breezy.mjs

**Kind:** test
**Purpose:** Checks the Breezy provider with a fake ctx: detection (`breezy_board` or `*.breezy.hr` careers_url), list parsing, JSON-LD description extraction, `shouldFetchContent` gating of posting-page requests, tolerance of a failed posting page, and error cases.

## Run
`node src/scan/test-breezy.mjs` (also discovered by `node src/test-all.mjs`). No live requests.

## Reads
- none

## Writes
- none

## Imports
- `./providers/breezy.mjs`, `node:assert/strict`.

## Used by
- `src/test-all.mjs` (auto-discovered `src/**/test-*.mjs`).
