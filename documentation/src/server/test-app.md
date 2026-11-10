# src/server/test-app.mjs

**Kind:** synthetic Node test suite for `src/server/app.mjs`, `schemas.mjs` and `readiness.mjs`.

Run with `node --test src/server/test-app.mjs`. It injects readiness and database transports,
checks envelopes and truthful capabilities, and exercises Host/Origin/fetch-metadata/preflight,
input-boundary, nonce and safe-error handling. It also injects and checks the default-readiness
resource close callback on shutdown. A secret sentinel verifies that transport errors
do not leak into responses. The suite never contacts the personal database, subscription CLIs,
external providers or private artifact locations.
