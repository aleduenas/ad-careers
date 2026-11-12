# src/lib/llm-prices.mjs

**Authority:** `documentation/dashboard-migration/packages/4.7-cost.md` (D084).

Public API prices for the Cost page. `loadPrices({ file, defaultFile, readText })` returns `{ prices, error, source }`. The private
`config/llm-prices.json`, when present, replaces the shipped defaults entirely (`source: 'config'`).
When it is absent the shipped `config/examples/llm-prices.example.json` is used (`source: 'default'`),
so a fresh install shows prices. A config file that exists but cannot be read or fails validation is
an error (`unreadable` or `invalid`, no prices, never file text or a path) and is never silently
replaced by the defaults; the Cost service turns it into 503 `PRICES_UNREADABLE`. `validatePrices` enforces version 1, provider `claude` or `codex`, a
model name, four non-negative USD-per-million-token fields, a `source` string and unique
provider/model pairs; unknown extra fields are dropped. `priceIndex` and `priceKey` look prices up
by provider and model exactly as recorded in `llm_calls`.

`findPrice(index, provider, model)` matches the exact id, else the id after removing one trailing
`-YYYYMMDD` date suffix (so `claude-haiku-4-5-20251001` finds `claude-haiku-4-5`). Nothing else: a
future `claude-sonnet-5-6` never takes the `claude-sonnet-5` price, and `[1m]` suffixes, case changes
and other prefixes stay unpriced.

`estimateUsd(tokens, price)` returns `(input x inputPrice + cachedInput x cachedPrice + cacheWrite x
cacheWritePrice + output x outputPrice) / 1,000,000` rounded to 6 decimals, or `null` when the model
has no price. The token buckets are disjoint: input is uncached input only (the Codex parser removes
cached and written tokens from `input_tokens`), cached input is cache reads, cache write is cache
creation, and output already contains reasoning and thinking tokens. `reasoningTokens` is display
only and is never added again.

## Billing rules confirmed on the official pages (2026-11-12)

- **Reasoning and thinking:** OpenAI's reasoning guide says reasoning tokens "are billed as output
  tokens". Anthropic's thinking page says thinking tokens are "billed as output tokens" and that
  `output_tokens_details.thinking_tokens` is part of `output_tokens`.
- **Anthropic caching:** `input_tokens` excludes cache reads and cache creation; the three counts
  are separate and added. Cache reads cost 0.1x input (0.05x on Sonnet 5.5 and Opus 5.5, as the
  pricing page footnotes). The Claude entries use the 1-hour cache write price (2x
  input), because the Claude CLI writes 1-hour caches (reproduced against the CLI's own reported
  cost); the usage counters do not distinguish the two lifetimes.
- **OpenAI caching:** `input_tokens` includes cached and cache-write tokens; ordinary input is
  `input_tokens - cached_tokens - cache_write_tokens`, cached reads use the cached-input price and
  writes cost 1.25x input for the default 30-minute lifetime (2.5x for 12 hours). The example uses
  the 30-minute price.
- **Haiku 5.5 tiers:** a request whose prompt (input + cache reads + cache writes) is over 100,000
  tokens pays higher prices. An entry may carry `longContext: { promptTokensOver, ...four prices }`.
  `estimateUsd(tokens, price, calls)` applies it when the prompt per call is over the threshold:
  exact for one call (the calls list), an average per row for the grouped summary.
- **Cache write lifetime:** the usage counters do not say whether a write was 5-minute or 1-hour, so
  table prices use the 1-hour rate for Claude and the 30-minute rate for OpenAI. A CLI-reported cost
  avoids this.
- **Not in the table:** web-search and other per-request fees. They appear only where the CLI
  reported the cost.
- **Reported cost first:** the Cost service uses Claude's own `total_cost_usd` (stored as
  `reported_cost_usd`) for a call when present and the table only for calls without it.
- **Aliases:** `sonnet`, `opus` and `haiku` are priced as the latest model of each family (5.5 on
  the fetch date); the full ids are listed too because the CLI reports full ids in its model usage
  (matched as described above).
  Re-check the alias mapping and prices when models change.

**Tests:** `node --test src/lib/test-llm-prices.mjs`.
