# src/scan/providers/workable.mjs

**Kind:** provider
**Purpose:** Workable public job-board provider (`id: workable`). Reads the no-auth markdown feed at `apply.workable.com/{account}/jobs.md`, follows each row's `.md` detail link for the complete JD, and expands per-country feeds when the account page is a directory rather than a table. Exports `parseWorkableMarkdown` and `parseWorkableCountries` for tests.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `workable_board` (account slug) or `careers_url` on `https://apply.workable.com/{slug}/`; `name` becomes the company.
- Network: `GET https://apply.workable.com/{slug}/jobs.md`; for directory pages, `GET .../jobs.md?location[0][country]={country}` per country listed under `## Locations`; then `GET` of each row's `[View](...jobs/view/{id}.md)` detail feed.

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector succeeds when a feed URL can be derived (`workable_board`, or https `careers_url` whose host is exactly `apply.workable.com`), or explicit `provider: workable`.
- `src/scan/test-workable.mjs`, `src/scan/test-scan-coverage.mjs`.

## Provider contract (providers only)
- detector: `workable_board` field or `apply.workable.com` `careers_url`.
- discovery: markdown table rows containing `[View](...)`; the public URL is the detail link minus `.md`. Rows whose link is not on `https://apply.workable.com` are dropped. Directory pages ("Use the search endpoint to filter results") are expanded by country (1 to 50 countries, else an error), and results are deduplicated by URL; a country feed that is still a directory throws.
- JD retrieval: the detail `.md` feed, fetched only when not in probe mode and `ctx.shouldFetchContent` allows; fetch failures leave `content: null`.
- rate/ban handling: sequential requests, no retries.

## Notes
- Location is the third table column verbatim (for example `Toronto, Canada (Hybrid)`).
- Every job carries `contentRequired: true`.
- Errors are thrown rather than reported as an empty successful scan so `verify-portals` and the coverage report show the failure.
