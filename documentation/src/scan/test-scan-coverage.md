# src/scan/test-scan-coverage.mjs

**Kind:** test
**Purpose:** Two groups of checks. `fixtureTests` exercises `buildTitleFilter` and the Workable, Pinpoint, SuccessFactors, Ashby and Greenhouse providers against in-memory HTTP contexts (`get`/`getJson` stubs recording the URLs they were asked for). `verifierTests` runs `verifyPortalEntries` with a fixture provider and then loads the real providers against the private `config/portals.yml` to assert the seniority gate rejects director/VP/head/manager titles and that no tracked company is unclassified.

## Run
`node src/scan/test-scan-coverage.mjs` (also discovered by `node src/test-all.mjs`). Prints `scan coverage/provider tests OK`.
- No network: every provider `fetch` receives a stub context, and the verifier is called with a stub `httpCtx`.
- Requires `config/portals.yml` to exist (private user file) with at least one tracked company; fails otherwise.

## Reads
- `config/portals.yml` (`title_filter`, `tracked_companies`) via `js-yaml` and `src/lib/root.mjs`.
- All `src/scan/providers/*.mjs` through `loadProviders()`.

## Writes
- none (`scan.mjs` import creates `data/` if missing)

## Imports
- `./scan.mjs` (`buildTitleFilter`, `loadProviders`), `./providers/ashby-api.mjs`, `./providers/greenhouse-api.mjs`, `./providers/pinpoint.mjs` (`parsePinpointResponse`), `./providers/successfactors.mjs` (`inferSuccessFactorsLocation`, `parseSuccessFactorsTiles`), `./providers/workable.mjs` (`parseWorkableMarkdown`), `../helpers/verify-portals.mjs` (`classifyPortal`, `verifyPortalEntries`), `../lib/root.mjs`, `js-yaml`.

## Used by
- `src/test-all.mjs` (auto-discovered `src/**/test-*.mjs`).

## Notes
- Asserts exact request sequences, for example Workable `jobs.md` then the detail `.md`, Pinpoint `postings.json`, SuccessFactors `startrow=0` then `startrow=1`, Ashby board then `jobPostingId=abc`, Greenhouse `?content=true`.
- Asserts per-entry `title_filter_positive` extends the global positives while `Lead, Software Developer` is still rejected by the word-boundary negative matcher.
- The unused imports `execFileSync`, `mkdtempSync`, `rmSync`, `statSync`, `tmpdir` and `fileURLToPath` are leftovers; nothing is executed or written through them.
- Observation: because it reads the live portal config, the "no unclassified portals" assertion turns a config mistake into a test failure, which is intended.
