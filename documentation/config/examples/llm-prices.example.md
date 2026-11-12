# config/examples/llm-prices.example.json

**Authority:** [config/examples/llm-prices.example.json](../../../config/examples/llm-prices.example.json)
and `documentation/dashboard-migration/packages/4.7-cost.md`.

Example of the optional private `config/llm-prices.json` that the Cost page reads to show what the
same launcher calls would cost at public API prices (the plan is a subscription; tokens stay the
authority). It is also the shipped default: with no `config/llm-prices.json` the server uses this file as is. To change prices copy it, drop `.example` and edit; the copy replaces this file entirely (an invalid copy is an error, not a fallback). `src/lib/llm-prices.mjs` reads it
on every request, so no restart is needed.

`version` is 1. Each entry in `prices` has `provider` (`claude` or `codex`), `model` exactly as the
call log records it, four USD-per-million-token fields (`inputUsdPerMtok`, `cachedInputUsdPerMtok`,
`cacheWriteUsdPerMtok`, `outputUsdPerMtok`) and a `source` naming the pricing page and fetch date.
An entry may add `longContext` (`promptTokensOver` plus the four prices) for a long-prompt tier, used for Haiku 5.5. A model with no entry is shown as unpriced and costs null, never zero.

The sample entries were taken from Anthropic's pricing page and OpenAI's pricing page on 2026-11-12:
Claude Sonnet 5.5, Opus 5.5 and Haiku 5.5 (under their aliases and full ids), Sonnet 5 and Haiku 4.5 (the ids seen in the call log; a dated id such as `claude-haiku-4-5-20251001` matches after its date suffix is removed) and the two Codex
models in `llm-providers.example.json`. Cache writes use the 1-hour (Claude, 2x input, what the CLI writes) and 30-minute
(OpenAI) rates; Haiku carries the over-100,000-token tier as `longContext`. How reasoning, cached and written
tokens are billed is in `documentation/src/lib/llm-prices.md`.
