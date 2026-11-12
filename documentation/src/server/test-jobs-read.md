# src/server/test-jobs-read.mjs

**Kind:** synthetic Node test suite for `src/server/jobs-read.mjs`, `jobs-materials.mjs`,
`jobs-compensation.mjs` and `jobs-paths.mjs`.

Run with `node --test src/server/test-jobs-read.mjs`. It injects an in-memory `query` returning
fixture rows for every status, then checks strict query normalization, exact filter semantics,
literal Unicode and wildcard-character search, bigint ID identity, manual-salary and partial-pair
projection, signed cursor paging (forward, backward, tampered, mismatched and stale), null-last
sorting with ID ties, the overview formulas against Go's behavior, artifact folder matching
(exact ID, duplicate ID, legacy fallback) and compensation reads inside and outside the allowed
roots. Temporary directories stand in for `output/` and `data/evaluations/`; the personal
database and private work product are never touched.

D061 cases cover each new field accepted and rejected, the positive-score population rule, ISO week
matching against `weeklyActivity`, `any` including Pending, and cursor binding to the new fields.
