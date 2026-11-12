# src/server/test-legacy-runs.mjs

Unit tests for `legacy-runs.mjs` (`node --test src/server/test-legacy-runs.mjs`) with fixture records
in a temporary root and injected liveness. Covered: the parser (valid, sparse, every malformed form,
browser-run recognition); the classifier (terminal states, live owner, dead owner, no pid, older than
24 h, recycled pid, genuine late-starting owner, unreadable start time); the wire shape, ordering,
job filter and limit; running rows always listed; skipped and counted records (bad JSON, bad action,
oversized, browser-run duplicates, links where available); and `find` returning only a log file
name. `test-runs.mjs` covers the merge into `list()`, `get`, `log` and the `run_id` record.
