# src/scan/test-hiring-cafe.mjs

**Kind:** test
**Purpose:** Offline assertions for the canonical JD helper that the hiring.cafe provider depends on: entity/mojibake repair in `htmlToText`, embedded-description extraction from a search hit, JSON-LD and microdata extraction from HTML, Greenhouse API routing through an injected `fetchImpl`, refusal to substitute the AI `requirements_summary` for a missing JD, and per-host scheduling in `mapWithHostLimits`.

## Run
`node src/scan/test-hiring-cafe.mjs` (also discovered by `node src/test-all.mjs`). Prints `hiring.cafe provider tests passed`.
- No network by default: HTTP is mocked by passing `fetchImpl` functions that return `Response` objects built in-process.
- Optional `--live-url <url>` performs one real `fetchCanonicalJobDescription` against that URL and asserts a full JD was found. `test-all.mjs` never passes it.

## Reads
- none (fixtures are inline; no files, config or env vars)

## Writes
- none

## Imports
- `./providers/_canonical-jd.mjs` (`extractDescriptionFromHtml`, `extractEmbeddedDescription`, `fetchCanonicalJobDescription`, `mapWithHostLimits`), `./providers/_http.mjs` (`htmlToText`), `node:assert/strict`.

## Used by
- `src/test-all.mjs` (auto-discovered `src/**/test-*.mjs`).

## Notes
- Verifies the Greenhouse fetcher requests `boards-api.greenhouse.io/v1/boards/example/jobs/12345` and reports `method: 'greenhouse'`.
- Verifies that when no strategy yields 300+ characters the result is `null` rather than the AI summary.
- The concurrency check expects the second scheduled item to come from the other host (`b.example`) when `perHost: 1`.
