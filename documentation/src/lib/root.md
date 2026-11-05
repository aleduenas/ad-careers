# src/lib/root.mjs

**Kind:** shared module
**Purpose:** Exports the absolute repository root as a single constant (`root`, also the default export), computed once from this file's own location (`src/lib/` is two levels below the root). It exists so that no other script derives the root from its own folder depth (layout rule 5), which would break whenever a file moves.

## Run
Not runnable; imported by other modules.

## Reads
- none (only `import.meta.url`)

## Writes
- none

## Imports
- none (Node built-ins only)

## Used by
- `src/lib/_database.mjs` (re-exports `root`)
- `src/lib/cli-runtime.mjs`
- `src/helpers/prune-logs.mjs`
- `src/analytics/analyze-patterns.mjs`, `src/analytics/followup-cadence.mjs`
- `src/eval/evaluate-jobs.mjs`, `src/eval/_evaluation-cli.mjs`, `src/eval/test-evaluation-cli.mjs`
- `src/cvgen/draft-cv.mjs`, `src/cvgen/draft-cover-letter.mjs`, `src/cvgen/publish-cover-letter.mjs`, `src/cvgen/test-cv-content.mjs`, `src/cvgen/test-cv-worksheet.mjs`
- `src/scan/add-pasted-jd.mjs`, `src/scan/test-scan-coverage.mjs`
- `src/test-all.mjs` lists it as a required system file

## Notes
- Many scripts still import `root` through `src/lib/_database.mjs` instead of this file; both resolve to the same value.
- If this file ever moves out of `src/lib/`, the `'..','..'` hop count must change with it; that is the one place the depth is allowed to be hard-coded.
