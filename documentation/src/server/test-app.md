# src/server/test-app.mjs

**Kind:** synthetic Node test suite for `src/server/app.mjs`, `schemas.mjs` and `readiness.mjs`.

Run with `node --test src/server/test-app.mjs`. It injects readiness and database transports,
checks envelopes and truthful capabilities, and exercises Host/Origin/fetch-metadata/preflight,
input-boundary, nonce and safe-error handling. It covers the jobs, overview, job detail and material routes with injected readers (params,
query rejection, headers for text and PDF, safe error envelopes), the static-path query rule and
the pool ownership rule. `GET /ready` and the session are checked to report the same `taskDispatch` truth. It also covers the provider settings routes (read, guarded writes, conflict, validation errors,
readiness, unavailable service, `providerSettings`). It also covers the optional `selection` override on `POST /runs` (accepted shape, schema rejections,
the merged selection on the wire) and the `PREREQUISITE_FAILED` and `RUN_ACTIVE` envelopes. It also
covers the intake routes (guard, sizes, companies query, conflicts with `error.current`,
unavailable service, `intake` capability), the scan variant of `POST /runs` and the scan-report
route. It also covers the job write routes (guard, sizes, conflicts with `error.current`, unavailable
writer, `jobWrites`) and the material filename segment. It also covers the run routes with an injected runs service (write guard: nonce and JSON,
body validation, query allowlist, safe errors, unavailable service). It also injects and checks the default-readiness
resource close callback on shutdown. A secret sentinel verifies that transport errors
do not leak into responses. The suite never contacts the personal database, subscription CLIs,
external providers or private artifact locations.

Stage 3.5 cases: the schema export list, the letter routes (read, guarded PUT, malformed bodies,
`LETTER_CONFLICT` carrying `error.current`, a 256 KB control-text body above the 1 MiB default,
503 without a service), the letter PDF route headers, and the `publish` variant of `POST /runs`.

The jobs route test also passes `filter=any`, `scoreMin`, `scoreMax` and `addedWeek` through to the reader and rejects duplicates.

Stage 4.7 cost cases: `range`, `jobId`, `limit` and `estimates` pass to the injected cost service, bad, repeated or unknown query keys are 400, no POST route exists, a missing service is 503 `COST_UNAVAILABLE`, storage errors keep their public codes, and the session `cost` capability follows the service.
