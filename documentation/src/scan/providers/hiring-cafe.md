# src/scan/providers/hiring-cafe.mjs

**Authority:** [src/scan/providers/hiring-cafe.mjs](../../../../src/scan/providers/hiring-cafe.mjs).

Role discovery with original-JD enforcement.

## Run and callers

Dynamically loaded by scan.mjs. Requires explicit `provider: hiring-cafe` and search_roles; `createHiringCafeProvider` accepts injected browser/cache/resolvers for offline tests.

## Inputs

Reads the generated role cache. Uses a new browser context for every uncached role and stops subsequent live searches on the first 403/429. Eligible stale cache may then supply results; expired/future-dated records do not. A malformed 200 response without a valid ssrHits array is never cached.

## Behavior and outputs

Filters geography and caller eligibility before bounded canonical-JD retrieval; missing JDs remain content:null so the scanner defers them. AI fields are labelled metadata. Cache writes occur only outside dry-run; browser contexts close on success/failure. Uses Playwright, fs/path and `_canonical-jd.mjs`. Provider regression tests cover caching, fresh contexts, stop/fallback, filters, dedup and malformed pages.
