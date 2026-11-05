# src/lib/_token-debug.mjs

**Kind:** shared module
**Purpose:** Opt-in token accounting for isolated CLI runs. `usageFromResult` parses the JSON a Claude or Codex CLI process printed and normalises it into one record (input, output, cache read/write, uncached); `logTokenUsage` writes that record as a per-request JSON file under `logs/token-usage/` when the debug toggle is on. Logging failures are swallowed so debugging never blocks a delivered evaluation or draft.

## Run
Not runnable; imported by other modules.

## Reads
- `logs/token-usage/debug.json`: logging happens only when this file exists and contains `{"enabled": true}`
- The CLI stdout passed in (Claude: one JSON envelope; Codex: JSONL, last `turn.completed` event)

## Writes
- `logs/token-usage/<ISO timestamp>-<8 hex>.json`, one file per request (directory created on demand)

## Imports
- none (Node built-ins only)

## Used by
- `src/cvgen/draft-cv.mjs`, `src/cvgen/draft-cover-letter.mjs`
- `src/eval/_evaluation-cli.mjs`
- `src/lib/test-token-debug.mjs`

## Notes
- For Claude, if `modelUsage` is present with complete counters for every model, the sum across all models is used (`accounting_basis: model_usage_all_models`); otherwise the top-level `usage` object is used and cache reads/writes are added to `input_tokens`. For Codex, `input_tokens` already includes cached tokens, so `uncached_input_tokens = input - cached`.
- When counters cannot be parsed the record carries `available: false` and a note saying usage is unknown, not zero.
- `logTokenUsage(root, {provider, model, workflow, phase, runPath, stdout, code})` stores `run_path` relative to the root. One file per request avoids interleaved writes from concurrent CLI workers.
- Errors are reported on stderr as "Token debug logging failed" and otherwise ignored.
