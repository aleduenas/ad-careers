# src/server/test-cost.mjs

**Kind:** synthetic Node test suite for `src/server/cost.mjs`. Run with `node --test
src/server/test-cost.mjs`. An injected reader and price list cover: per-model pricing and the
roll-ups per function, job and day with outputs validated against the `CostSummaryResponse` and
`CostCallsResponse` schemas; reasoning not double counted; unpriced models null and listed; empty
storage giving zeros; no prices file; `since` null for `all`; the 100-row job cap; the public call
shape and per-call price; strict query validation; storage errors mapped to public errors without
driver text; and the default reader delegating to the storage functions. No database or network. Reported cost beating the table, mixed reported/unreported rows and the long-prompt tier are covered too. The grouped summary uses the `unreported` token sums, and an invalid prices file is 503 `PRICES_UNREADABLE`. `unpricedCalls` is checked on every group type. `estimates` validation, passing it to the reader, echoing it, `estimatedCalls` on every group, table pricing of estimated rows and `source: 'estimate'` on calls are covered.
