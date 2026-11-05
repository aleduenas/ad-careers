# src/scan/providers/successfactors.mjs

**Kind:** provider
**Purpose:** SAP SuccessFactors Recruiting Marketing (RMK) public-board provider (`id: successfactors`). Pages through the board's `tile-search-results` HTML, parses each job tile for id, title, URL and city, then resolves full descriptions through the canonical JD helper. Exports `parseSuccessFactorsTiles` and `inferSuccessFactorsLocation` for tests.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `api` or `careers_url` (board base; a trailing `/search` or `/tile-search-results` is stripped), `max_pages` (default 40, forced to 1 in probe mode), `name` becomes the company.
- Network: `GET {base}/tile-search-results/?startrow={n}` repeatedly (HTML), then employer/ATS endpoints through `_canonical-jd.mjs`.

## Writes
- none

## Imports
- `./_canonical-jd.mjs` (`fetchCanonicalJobDescription`, `mapWithHostLimits`), `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector matches `successfactors.com`, `successfactors.eu` or `jobs2web.com` in `api` or `careers_url`, or explicit `provider: successfactors`.
- `src/scan/test-scan-coverage.mjs` (tile parser, location inference, fixture `get` fetch).

## Provider contract (providers only)
- detector: regex `successfactors\.(com|eu)|jobs2web\.com` on `api || careers_url`.
- discovery: paginated tile scraping; stops on an empty page, on a page with no new job ids, or at `max_pages`. `startrow` advances by the number of tiles parsed.
- JD retrieval: when not in probe mode and `ctx.shouldFetchContent` allows, `fetchCanonicalJobDescription({apply_url: url})` with `{concurrency: 5, perHost: 2}`. No inline text and no rendered fallback; unresolved jobs get `content: null`.
- rate/ban handling: sequential page fetches, host-limited detail concurrency, helper retry/backoff only.

## Notes
- Tile parsing: `<li class="... job-tile job-id-{n} ...">` blocks; `data-url` gives the path (relative paths are prefixed with the board origin), `jobTitle-link` the title, `{id}-section-city-value` the city. When the city element is missing, the location is inferred from the posting slug by removing the title words (`/job/Saint-John-Senior-Data-Engineer-NB/456/` -> `Saint John`).
- Every job carries `contentRequired: true`; the internal `id` is stripped from the returned objects.
- Observation: `careers_url` values on a custom employer domain (not `successfactors.*`/`jobs2web.com`) need `provider: successfactors` explicitly.
