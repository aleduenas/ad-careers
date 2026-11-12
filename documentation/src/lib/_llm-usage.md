# src/lib/_llm-usage.mjs

**Kind:** shared module
**Purpose:** Token accounting for launcher LLM calls. Normalizes provider CLI output, writes one `llm_calls` row per call (migration 011) and provides the read queries the Cost API uses.

## Run
Not runnable; imported by `src/lib/cli-runtime.mjs`, `src/helpers/import-llm-usage.mjs`, tests and the Cost API.

## Exports
- `parseUsage(provider, stdoutText)` returns `{ model, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens, reportedCostUsd, durationMs }` or `null` when the output has no usable counters (empty, not JSON, no usage object, no `turn.completed` event, unknown provider).
- `recordCall(row, { query })` inserts one row; `usage: null` stores a zero row with `usage_missing = true`. It validates provider, function label and model, takes `jobId` only when numeric and `runId` only when a UUID, and returns the stored row, or `null` when the `log_ref` already exists.
- `recordCallSafe(meta, result, durationMs, options)` is the hook `processRun` calls: parse, record, and on any failure write one line to stderr and return. It never throws. The run id defaults to `CAREER_RUN_ID`.
- `aggregateCalls({ range, query, now })` returns `{ range, since, totals, byModel, byFunction, byJob, byDay }`. `byJob` is capped at 100 rows sorted by total tokens; `byDay` has one row per UTC day and model so a price view can cost each day exactly; empty data gives zeros and empty lists.
- `readCalls({ range, jobId, limit, query, now })` returns calls newest first; limit defaults to 100 and is capped at 500. Rows carry `model`, `requestedModel`, `reportedCostUsd` and the token counts.
- `countCalls({ range, jobId, query, now })` returns the unlimited integer count for `readCalls`' filter.
- `cubeCalls({ range, query, now })` returns `{ since, rows }`, one row per (UTC day, provider, model, function, job) with company and role from a LEFT JOIN, token counts, `calls`, `missingCalls`, `reportedCostUsd` (sum over the calls that carry one) and `reportedCostCalls`, and `unreported: { calls, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }`, the sums over the group's calls that carry no reported cost (so only those need pricing from a table). No LIMIT.
- `logRefOf(root, path)` builds the repository-relative POSIX `log_ref`. `FUNCTIONS`, `PROVIDERS` and `RANGES` (`7d`, `30d`, `90d`, `all`) are the vocabularies.

## Reads
- `llm_calls` and `jobs` (company and role for per-job rows) through `src/lib/_database.mjs`, loaded lazily so parsing needs no database. Every function accepts an injected `query` for tests.

## Writes
- `llm_calls` only.

## Normalization rules
- Claude: sums `modelUsage` across every model the CLI used (sub-agents included) when complete, else top-level `usage`. `inputTokens` is uncached only; cache read and write are separate; reasoning is `usage.output_tokens_details.thinking_tokens`, included in output. `reportedCostUsd` is `total_cost_usd`.
- Codex: the last `turn.completed` event. `input_tokens` includes the cached share, so `inputTokens = input - cached - cache_write`; `reasoning_output_tokens` is included in output.
- Reasoning is clamped to output so the table's CHECK can never reject a row.

## Used by
- `src/lib/cli-runtime.mjs`, `src/eval/_evaluation-cli.mjs` (`logRefOf`), `src/helpers/import-llm-usage.mjs`, `src/lib/test-llm-usage.mjs`, `src/lib/test-llm-usage-database.mjs`.

## Notes
- `model` is the real model id from the output (Claude: the `modelUsage` key with the most output tokens; Codex: none reported, so the requested alias), `requested_model` the alias asked for. A Claude call that used several models is stored whole under the primary one; the rest are not stored.
- No file fallback exists: a recording failure loses one accounting row and nothing else.
