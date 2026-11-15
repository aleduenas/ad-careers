# src/lib/test-url-key.mjs

**Kind:** test
**Purpose:** Unit tests (including `findJobByUrl` with a fake query) for `urlKey` and `legacyUrlKey` in `src/lib/_database.mjs`: scheme/`www.`/slash/case normalisation, fragment and tracking-parameter removal (hash-route `#/` and `#!/` fragments kept), kept meaningful parameters (`gh_jid`, `jobId`, `career_job_req_id`, `token`, `for`), Workday locale-segment removal, and that the legacy function keeps the old output.

## Run
`node src/lib/test-url-key.mjs` (also discovered by `node src/test-all.mjs`). No network or database access.

## Reads
- none

## Writes
- none

## Imports
- `./_database.mjs` (`urlKey`, `legacyUrlKey`), `node:assert/strict`. Importing the module does not open a connection.

## Used by
- `src/test-all.mjs` (auto-discovered `src/**/test-*.mjs`).
