# src/scan/providers/greenhouse-api.mjs

**Kind:** provider
**Purpose:** Greenhouse job-board provider (`id: greenhouse`). One request to the public boards API with `content=true` returns every posting with its HTML description, so discovery and JD retrieval are a single call.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `api` (a `boards-api.greenhouse.io` URL, used verbatim; `?content=true` appended when it has no query) or `greenhouse_board` (slug); `name` becomes the company.
- Network: `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` (reads `jobs[]`: `title`, `absolute_url`, `location.name`, `content`).

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector `entry.greenhouse_board || entry.api.includes('boards-api.greenhouse.io')`, or explicit `provider: greenhouse`.
- `src/scan/test-scan-coverage.mjs` (fixture `getJson`).
- `config/examples/portals.example.yml` uses the `api:` form for most Greenhouse entries.

## Provider contract (providers only)
- detector: `greenhouse_board` field or `boards-api.greenhouse.io` in `api` (not in `careers_url`).
- discovery: single list call.
- JD retrieval: structured HTTP, inline `content` normalized by `htmlToText` (handles boards that return entity-encoded HTML).
- rate/ban handling: none needed (one request per company); no retries.

## Notes
- A `job-boards.greenhouse.io` `careers_url` alone does not trigger detection; the entry needs `api:` or `greenhouse_board:`.
- Postings without `content` yield `content: null` and are deferred by `scan.mjs`.
