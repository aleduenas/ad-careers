# src/scan/test-location-gate.mjs

**Kind:** test
**Purpose:** Regression cases for `gate()` in `location-gate-core.mjs`: US-only residency language overrides remote metadata (FAIL), remote-from-Canada passes, a provider location of `New York, United States (Remote)` fails even with a remote title, a UK city fails, `Remote (United States | Canada)` passes, and a remote-friendly multi-US-city string fails.

## Run
`node src/scan/test-location-gate.mjs` (also discovered by `node src/test-all.mjs`). Prints `location gate tests passed`. No network; all inputs are inline strings.

## Reads
- none

## Writes
- none

## Imports
- `./location-gate-core.mjs` (`gate`), `node:assert/strict`.

## Used by
- `src/test-all.mjs` (auto-discovered `src/**/test-*.mjs`).

## Notes
- Two cases pass JD text with frontmatter (`location:` and `type:` keys) to exercise the frontmatter path; the rest pass the provider `jobLocation` argument to exercise the supplied-location path.
- Only the `decision` field is asserted, not `reason` or `confidence`.
