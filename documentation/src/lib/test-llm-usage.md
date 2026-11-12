# src/lib/test-llm-usage.mjs

**Kind:** test
**Purpose:** Unit test for `src/lib/_llm-usage.mjs` and the recording hook in `processRun`.

## Run
`node src/lib/test-llm-usage.mjs`. No database, Docker or model CLI needed; discovered by `src/test-all.mjs`.

## Covers
- `parseUsage` for Claude (all-model sum, top-level fallback, thinking tokens, reported cost) and Codex (cached share removed from input, reasoning inside output), and `null` for empty, malformed, usage-less and unknown-provider output.
- `usageFunction` phase mapping from `src/eval/_evaluation-cli.mjs`.
- `recordCall` parameters through an injected `query`, the zero `usage_missing` row, invalid provider and label rejection, and that a recording failure is written to stderr and never thrown.
- `processRun` with a mocked child process (`node -e` printing a fixture; no model is run) records exactly one row per call with the right counts for Claude, Codex and a stdout with no usage.
