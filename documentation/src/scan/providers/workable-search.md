# src/scan/providers/workable-search.mjs

**Kind:** provider
**Purpose:** Cross-company discovery through the public Jobs by Workable search API (`id: workable-search`). For each configured search term it pages through `jobs.workable.com/api/v1/jobs`, keeps published postings with an explicit location, and assembles the full JD from the response's description, requirements and benefits sections. Exports `normalizeWorkableSearchJob` for tests.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `provider: workable-search` (required, no detector), `search_terms[]` (required), `search_location` (default `Canada`), `max_pages_per_query` (default 25).
- Network: `GET https://jobs.workable.com/api/v1/jobs?query={term}&location={search_location}[&pageToken=...]` (reads `jobs[]`, `nextPageToken`).

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: selected only by explicit `provider: workable-search` (`detect()` returns `null`).
- `src/scan/test-workable-search.mjs`.

## Provider contract (providers only)
- detector: none.
- discovery: token-paginated search per term, deduplicated by URL across terms. A repeated page token or reaching `max_pages_per_query` throws; a non-array `jobs` throws.
- JD retrieval: inline; `description` + `## Requirements` + `## Benefits` sections from the search response (no extra requests).
- rate/ban handling: none by design; any HTTP failure aborts the provider on the first error (no retries, no challenge bypass).

## Notes
- `normalizeWorkableSearchJob` drops jobs unless `state === 'published'`, the URL is `https://jobs.workable.com/view/...`, and at least one non-`TELECOMMUTE` location string exists (an unspecified remote geography is never treated as Canadian). Location is prefixed `Remote - ` when `workplace === 'remote'`.
- When `search_location` is `Canada` (the default), jobs are additionally required to contain the word `Canada` in their location string.
- Company is `raw.company.title`, so one entry yields many companies; the company-role dedup in `scan.mjs` still applies per company.
- Every job carries `contentRequired: true`.
