# src/scan/providers/icims-api.mjs

**Kind:** provider
**Purpose:** iCIMS career-site provider (`id: icims`) for JD-detail fetching only. iCIMS has no uniform public listing endpoint, but its job detail pages embed a schema.org `JobPosting` JSON-LD block with the full description, so this provider fetches the URLs listed in `job_urls` and extracts title, location and description from that block. It does not discover new postings.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `provider: icims` (required, no detector), `job_urls[]` (plain URL strings), `name` becomes the company.
- Network: `GET` of each configured job URL (HTML), sequentially.

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: selected only by explicit `provider: icims` (`detect()` returns `null`).

## Provider contract (providers only)
- detector: none.
- discovery: none; `job_urls` is the posting set. Empty list logs an error and returns `[]`.
- JD retrieval: structured HTTP, first `<script type="application/ld+json">` whose `@type` is `JobPosting`; `description` normalized by `htmlToText`. Pages without the block are logged as possibly closed and skipped.
- rate/ban handling: sequential requests, no retries.

## Notes
- Location is assembled from `jobLocation[].address` (`addressLocality, addressRegion, addressCountry`), multiple places joined with ` / `.
- Title defaults to `Unknown Role` when the JSON-LD has none.
- Does not consult `ctx.shouldFetchContent`; every listed URL is fetched each scan even if already tracked (URL dedup then drops it in `scan.mjs`).
