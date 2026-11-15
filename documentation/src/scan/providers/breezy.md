# src/scan/providers/breezy.mjs

**Kind:** provider
**Purpose:** Breezy HR job-board provider (`id: breezy`). Lists a board from its public JSON feed and reads the full description from each posting page. Returns `{title, url, company, location, content}` per job.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `breezy_board` (explicit board, e.g. `zero-hash`) or `careers_url` on `{board}.breezy.hr`; `name` becomes the company.
- Network: `GET https://{board}.breezy.hr/json` (array; uses `name`, `url`, `location.name`), then `GET {posting url}` per posting for the description.

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector `breezy_board` or a `*.breezy.hr` careers_url, or explicit `provider: breezy`.
- `src/scan/test-breezy.mjs` (fake ctx).

## Provider contract (providers only)
- detector: `breezy_board` field or `{board}.breezy.hr` host in `careers_url`.
- discovery: single list call; a non-array response throws `invalid list response`.
- JD retrieval: posting page fetched only when `ctx.shouldFetchContent(job)` is true (or absent); description from the JSON-LD `JobPosting`, else the page's description block; 5 concurrent requests. A failed page leaves `content: null` (scan.mjs defers it as Missing full JD).
- rate/ban handling: fixed concurrency of 5; no retries.

## Notes
- Location is `location.name`, or `Remote` when only `location.is_remote` is set, else empty.
- The page markup handling was written from Breezy's public conventions and verified only against fixtures; confirm with a `--dry-run --company` scan of a real board.
