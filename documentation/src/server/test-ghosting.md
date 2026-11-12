# src/server/test-ghosting.mjs

**Kind:** synthetic Node test suite for `src/server/ghosting.mjs`. Run with `node --test
src/server/test-ghosting.mjs`. Injected readiness, query and log cover: a pass calls readiness then
the SQL rule once and logs the count (singular and plural); a failing readiness or query skips
quietly without leaking driver text; overlapping passes are refused; `start` runs at startup and on
the interval and `stop` ends it; bad adapters are rejected. No database is used.
