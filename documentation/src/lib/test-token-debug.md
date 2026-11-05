# src/lib/test-token-debug.mjs

**Kind:** test
**Purpose:** Unit test for `src/lib/_token-debug.mjs`. It feeds synthetic Claude and Codex CLI output through `usageFromResult` to verify cache accounting on both bases (top-level usage and per-model sums), checks that unparseable output reports `available: false`, and exercises `logTokenUsage` with the toggle on and off.

## Run
`node src/lib/test-token-debug.mjs` with no arguments. No database, Docker or model CLI required. Discovered and run automatically by `src/test-all.mjs`.

## Reads
- none from the repository beyond its own fixture

## Writes
- `logs/tests/token-debug/run-<random>/` under the repository (a fake root containing `logs/token-usage/debug.json` and the generated usage files); removed in `finally` with a parent-directory guard

## Imports
- `src/lib/_token-debug.mjs` (`usageFromResult`, `logTokenUsage`)

## Used by
- `src/test-all.mjs` (section 2, discovered by the `test-*.mjs` pattern)

## Notes
- Expected totals: Claude top-level 100+25+200+50 = 375; Claude multi-model 405 with `accounting_basis: model_usage_all_models`; Codex 300+25 = 325 with 100 uncached input tokens.
- Two identical `logTokenUsage` calls must produce two distinct files, and a third call after `{"enabled": false}` must produce none.
- Because the fixture lives under `logs/tests/`, it falls under the 7-day deletion rule of `src/helpers/prune-logs.mjs` if a run ever fails to clean up.
