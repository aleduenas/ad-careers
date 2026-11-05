# src/scan/providers/canonical-urls.mjs

**Kind:** provider
**Purpose:** Zero-token ingestion of explicitly listed employer job URLs. Use it when an aggregator or a person reveals a posting but no discovery endpoint exists for that employer. Each configured URL must be the employer/ATS posting itself, never an aggregator detail page; the full JD is resolved through `_canonical-jd.mjs` (HTTP strategies, then a rendered Playwright fallback).

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `provider: canonical-urls` (required, no detector), `name`, `job_urls[]` where each item is `{url, title, location?, company?}` (a bare string is accepted but then fails the `url + title` requirement), `jd_concurrency` (default 6), `jd_concurrency_per_host` (default 2).
- Network: the configured URLs and their ATS APIs through `_canonical-jd.mjs`.

## Writes
- none (JD files and rows are written by `scan.mjs`)

## Imports
- `./_canonical-jd.mjs` (`fetchCanonicalJobDescription`, `fetchRenderedCanonicalJobDescription`, `mapWithHostLimits`), `playwright` (`chromium`).

## Used by
- `src/scan/scan.mjs`: selected only by explicit `provider: canonical-urls` (`detect()` returns `null`).

## Provider contract (providers only)
- detector: none.
- discovery: none; the list in `job_urls` is the posting set. Items missing `url` or `title` are logged and skipped.
- JD retrieval: `scanCtx.shouldFetchContent` first (skips already-known or filtered jobs), then `fetchCanonicalJobDescription({apply_url})` under host limits, then one shared headless browser for the unresolved remainder (`concurrency 3, perHost 1`). Jobs with no JD are returned with `content: null` and deferred by `scan.mjs`.
- rate/ban handling: only the retry/backoff inside `_canonical-jd.mjs`; no proxying or bypass. Aggregator hostnames are refused by the helper.

## Notes
- `company` defaults to the entry `name`; `location` defaults to empty, which makes the location filter pass and leaves the gate to the JD text.
- Every returned job carries `contentRequired: true` (currently informational; `scan.mjs` applies its own 300-character minimum).
- Observation: a URL already tracked in PostgreSQL is skipped by the URL dedup in `scan.mjs`, so a stale `job_urls` list costs nothing beyond config noise.
