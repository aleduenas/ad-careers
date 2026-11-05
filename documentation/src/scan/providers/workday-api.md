# src/scan/providers/workday-api.mjs

**Kind:** provider
**Purpose:** Workday (`myworkdayjobs.com`) provider (`id: workday`). Uses the public, unauthenticated CXS JSON API: a facet-discovery call resolves the country facet id, search calls page through postings per search term, and a detail call per posting returns the HTML description and locations.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `workday_tenant`, `workday_host`, `workday_site` (all required), `workday_search_terms[]` (default `Data, Engineer, Scientist, Machine Learning, AI`), `workday_search_all` (one empty-term search, skips the country facet), `workday_country` (default `Canada`), `careers_url` (detector only), `name` becomes the company.
- Network: `POST https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` with `{appliedFacets, limit: 20, offset, searchText}` (first call resolves `locationMainGroup > locationCountry` facet id), then `GET .../wday/cxs/{tenant}/{site}{externalPath}` per posting (reads `jobPostingInfo.title/location/additionalLocations/jobDescription/externalUrl`).

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector `careers_url.includes('myworkdayjobs.com')`, or explicit `provider: workday` (needed when the careers page is a marketing site that redirects into Workday).
- `src/scan/test-workday.mjs`.

## Provider contract (providers only)
- detector: `myworkdayjobs.com` in `careers_url`; the tenant/host/site fields are still mandatory.
- discovery: per term, pages of 20 (the CXS API rejects larger limits) up to 10 pages; stops when a short page arrives or `offset >= total`. Hitting the page cap with results remaining throws `incomplete results ... narrow the search terms`. Postings are deduplicated by `externalPath` across terms.
- JD retrieval: structured HTTP detail call, 5 concurrent; a failed detail leaves `content: null` with the stub title, constructed URL and `locationsText`.
- rate/ban handling: fixed concurrency of 5; no retries.

## Notes
- Location joins `jobPostingInfo.location` and `additionalLocations` with `; ` after deduplication (for example `Vancouver; Remote - Canada; Toronto`), so the location gate sees every listed site.
- The country facet is skipped when `workday_search_all` is set or when the country name is not found in the facet response (then all countries are searched).
- Does not consult `ctx.shouldFetchContent`; a detail request is made for every discovered posting.
- URL is `externalUrl` when present, otherwise `https://{tenant}.{host}.myworkdayjobs.com/{site}{externalPath}`.
