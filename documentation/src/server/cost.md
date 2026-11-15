# src/server/cost.mjs

**Authority:** `documentation/dashboard-migration/packages/4.7-cost.md`; shapes `CostSummaryResponse`
and `CostCallsResponse` in `src/server/schemas.mjs`.

Read-only Cost service (D084). Token counts in `llm_calls` are the authority; `estimatedUsd` prices
the same counts with `src/lib/llm-prices.mjs`. `createCostService({ reader, prices, now })` returns
`summary({ range })` and `calls({ range, jobId, limit })`. The default reader
(`createCostReader`) calls `cubeCalls`, `readCalls` and `countCalls` from `src/lib/_llm-usage.mjs`;
tests inject a reader with `cube`, `calls` and `count`.

**Routes** (registered in `app.mjs`, outside the write guard): `GET /api/v1/cost/summary?range=&estimates=` and
`GET /api/v1/cost/calls?range=&jobId=&limit=&estimates=`. `normalizeCostQuery` is strict: `range` is `7d`, `30d`
(default), `90d` or `all`; `jobId` is a positive integer string; `limit` is 1 to 500 (default 100); `estimates` is `include` (default) or `exclude`;
anything else, a repeated key or an unknown key is 400 `INVALID_REQUEST` with the field named.

**Summary:** the reader returns rows grouped by day, provider, model, function and job. The service
prices each row by its own model and rolls the rows up into `totals`, `byModel`, `byFunction`,
`byJob` (rows with a job, largest total first, at most 100) and `byDay` (ascending, only days with
calls). `since` is null for `all`; `until` is the request time. `totalTokens` is input + cached
input + cache write + output; `reasoningTokens` is a subset of `outputTokens`, shown only.

**Reported cost:** a call's `estimatedUsd` is the CLI-reported cost (`reported_cost_usd`) when it has
one, otherwise the table price, otherwise null. In the grouped summary each row's reported sum is
used for its reported calls and the table prices the row's `unreported` token sums (calls without a
reported cost, supplied by `cubeCalls`). The Haiku long-prompt tier is chosen by average prompt per
unreported call, and table prices use the 1-hour (Claude) cache-write rate.

**Estimates (D093):** rows with source `estimate` (past drafting runs, tokens estimated from saved
prompt and response sizes) are included unless `estimates=exclude`. The option is passed to every
reader call (`cube`, `calls`, `count`), so the reader filters in SQL; the summary echoes `estimates`
and every group carries `estimatedCalls` (the cube row's `estimatedCalls`, capped at its `calls`).
Estimated rows carry no reported cost, so they are priced from the table through the `unreported`
path like any unreported call. Calls show `source: 'estimate'`.

**Partial groups:** every group carries `unpricedCalls`, the number of its calls with neither a
reported cost nor a table price; `estimatedUsd` is a floor whenever it is above 0.

**Unpriced models:** a model is listed only when it has unreported calls and no price entry; it is listed in `unpriced` as `provider/model` and
costs null. A group's `estimatedUsd` is the sum of its priced rows, null when it has calls and none
are priced, and 0 when it has none. The total is therefore a floor while `unpriced` is non-empty.
With no `config/llm-prices.json` the shipped example prices apply. An invalid config file is 503
`PRICES_UNREADABLE` on both routes; the response never contains the file path or its contents. `prices` echoes the loaded entries.

**Calls:** newest first, each call priced on its own (null when unpriced), with the unlimited
`total` for the range and job. Storage failures map to the public `DATABASE_UNAVAILABLE` or
`SCHEMA_NOT_READY` (migration 011 not applied) errors; driver text is never forwarded. Without a
service the routes answer 503 `COST_UNAVAILABLE` and the session capability `cost` is false.

**Tests:** `node --test src/server/test-cost.mjs`; route cases are in `test-app.mjs`.
