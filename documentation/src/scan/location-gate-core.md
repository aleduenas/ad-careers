# src/scan/location-gate-core.mjs

**Kind:** shared module
**Purpose:** Deterministic location gate used by `scan.mjs` after a JD is cached. `gate(url, company, role, jdContent?, jobLocation?)` returns `{decision: PASS|FAIL, reason, confidence: high|low}` using regex signals for Toronto-area, Canada, US, remote and hard work-authorization phrases. Eligible means Toronto-area (on-site/hybrid) or explicitly remote-from-Canada; when in doubt it passes with low confidence and leaves the final call to the evaluator. Also exports `parseFrontmatter` and the pattern arrays.

## Run
Not runnable; imported.

## Reads
- none (pure functions over the arguments it receives; no files, config, env or network)

## Writes
- none

## Imports
- none

## Used by
- `src/scan/scan.mjs` (calls `gate()` with the freshly cached JD text and the provider-supplied location).
- `src/scan/test-location-gate.mjs`.

## Notes
- Decision order:
  1. `HARD_REJECT_PHRASES` in the JD body (US-authorization, US-residency, "not open to Canada") always FAIL, high confidence.
  2. Provider location (`jobLocation`, else frontmatter `location:`; `N/A`, `unknown`, `multiple locations` are treated as empty): Toronto-area PASS; remote+Canada PASS; remote+US FAIL; remote alone PASS low; Canada outside Toronto FAIL; US FAIL; any other explicit location FAIL.
  3. URL/company/role metadata: remote with a US signal and no Canada signal FAIL; remote PASS; Toronto-area PASS.
  4. No JD text: PASS low ("evaluator will verify").
  5. Frontmatter `type: remote` PASS; frontmatter location Toronto PASS; remote-without-US PASS; Canada-non-Toronto FAIL; US location needs both a strong remote phrase and a Canada/North America/worldwide mention in the body to PASS low, otherwise FAIL.
  6. Body: strong remote phrase PASS; Toronto mention PASS; non-hybrid "remote" PASS low; default PASS low.
- `TORONTO_AREA_PATTERNS` includes all of Ontario plus `-ON-`; `CANADA_PATTERNS` includes `\bON\b`, `\bBC\b` and `\bCAN\b` which can match unrelated uppercase tokens in URLs.
