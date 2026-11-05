# src/scan/providers/pinpoint.mjs

**Kind:** provider
**Purpose:** Pinpoint ATS provider (`id: pinpoint`). Reads the public `postings.json` feed of a `*.pinpointhq.com` board, uses any inline description, and resolves the rest through the canonical JD helper. Exports `parsePinpointResponse` for tests.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `api` (any https URL; used as the board base) or `careers_url` (must be `https://{slug}.pinpointhq.com`); `name` becomes the company.
- Network: `GET {origin}{path}/postings.json` (reads `data[]`: `title`, `url`, `location.{name|city,province}`, `description` or `job.description`), then employer/ATS endpoints through `_canonical-jd.mjs` for postings without inline text.

## Writes
- none

## Imports
- `./_canonical-jd.mjs` (`fetchCanonicalJobDescription`, `mapWithHostLimits`), `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector succeeds when `resolveApiUrl(entry)` yields a URL (explicit https `api`, or a `careers_url` on a `pinpointhq.com` subdomain), or explicit `provider: pinpoint`.
- `src/scan/test-scan-coverage.mjs` (`parsePinpointResponse` and a fixture `getJson` fetch).

## Provider contract (providers only)
- detector: https `api` field, or `careers_url` hostname matching `^[a-z0-9-]+\.pinpointhq\.com$`.
- discovery: single `postings.json` call; entries with a missing title or non-https URL are dropped.
- JD retrieval: inline description when present; otherwise, when not in probe mode and `ctx.shouldFetchContent` allows, `fetchCanonicalJobDescription({apply_url})` with `{concurrency: 5, perHost: 2}`. No rendered fallback.
- rate/ban handling: host-limited concurrency plus the helper's retry/backoff; nothing else.

## Notes
- `ctx.probe` (set by `verify-portals.mjs`) skips all JD retrieval.
- Every job carries `contentRequired: true`; jobs still lacking text are deferred by `scan.mjs`.
