# src/server/app.mjs

**Authority:** this module defines the Stage 1 HTTP boundary; response contracts are in
`documentation/dashboard-migration/design/STAGE1_CONTRACT.md`.

**Kind:** shared module. `createApp()` returns an unlistened Fastify app and accepts injected
readiness, loopback host/origin, development mode, nonce, owned-resource closer and optional production static handler for synthetic tests. Importing
the module does not start a listener. Stage 1 exposes only health, readiness and session reads.

The server checks the exact Host on every request, rejects `Forwarded` and all `X-Forwarded-*` headers,
unexpected Origin, cross-site fetch metadata and preflight requests. Development mode adds only
the documented Vite origin. API reads do not accept query parameters or bodies. The app sets
no-store and restrictive browser security headers, bounds JSON bodies to 1 MiB, and serializes
errors through safe public codes. `requireSessionNonce()` is a guard for future JSON writes; no
write route is installed in this package. Its not-found handler keeps unknown `/api` requests in
the JSON error envelope and delegates other misses only when a static handler was injected. The
default readiness adapter closes its lazily created PostgreSQL pool with the server.

**Imports:** Fastify, Node crypto, `../lib/_database.mjs`, `./readiness.mjs`, `./schemas.mjs`.

**Tests:** `node --test src/server/test-app.mjs` uses injected readiness and synthetic headers;
it does not connect to PostgreSQL or access private files.
