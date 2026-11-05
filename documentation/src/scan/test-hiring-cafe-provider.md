# src/scan/test-hiring-cafe-provider.mjs

**Authority:** [src/scan/test-hiring-cafe-provider.mjs](../../../src/scan/test-hiring-cafe-provider.mjs).

Injects fake browser/cache/JD resolvers into the actual provider. Verifies fresh contexts, fresh/stale/expired cache, 403/429 stop, Canada eligibility, dedup, pre-retrieval filtering, malformed pages and dry-run protection. Uses temporary files; no live requests.

Run: `node src/scan/test-hiring-cafe-provider.mjs`. Assertions fail with a nonzero exit code. Discovered by `src/test-all.mjs`; database/Chromium prerequisites are described above.

