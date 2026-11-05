# src/scan/providers/_canonical-jd.mjs

**Authority:** [src/scan/providers/_canonical-jd.mjs](../../../../src/scan/providers/_canonical-jd.mjs).

Original full-JD retrieval helpers.

## Run and callers

Used by discovery providers, never by evaluation/drafting to fetch fresh JDs.

## Inputs

Reads original description fields from search hits or fetches public employer ATS/careers pages. AI-processed description/summary fields are excluded. Supports structured extraction and a bounded rendered fallback; unsuccessful HTTP responses are rejected before DOM extraction.

## Behavior and outputs

Returns `{text, method}` or null. `mapWithHostLimits` bounds total/per-host requests and preserves output order. Protected aggregator detail hosts are excluded. Uses HTTP helpers; caller supplies/shares the browser for rendered fallback. `test-hiring-cafe.mjs` covers extraction and host concurrency; provider tests cover discovery cache behavior.
