# src/eval/_evaluation-cli.mjs

**Kind:** shared module
**Purpose:** Evaluation-side helpers for the launcher: rubric loading, manual-JD source detection, worksheet validators, company-cache merge and lookup, report rendering, and `invoke`, the checkpointed CLI call with repair retries. It parses the rubric from `llm/prompts/eval/scoring.md` at import time, so the dimension list and weights used by validation and scoring come from the prompt, not from code.

## Run
Not runnable; imported by other modules.

## Reads
- `llm/prompts/eval/scoring.md` at import (`loadRubric`: table rows matching `| name | NN% |`; weights must sum to 100)
- `llm/prompts/eval/company-research.md` (`companyPrompt`) and `llm/prompts/eval/repair.md` (`invoke` corrections) through `renderPrompt`
- the company cache path passed by the caller (`data/company-info/<slug>.md`) in `researchNeeded`; `<dir>/<phase>.json` checkpoints in `invoke`
- `data/jds/` through `cachedJD` (delegates to `src/lib/_cached-jd.mjs`)

## Writes
- `put`/`json`: atomic file writes (`.tmp` then rename) for run artifacts; `invoke` writes `<dir>/<phase>-<ts>-<attempt>.{prompt.txt,response.txt,stdout.log,stderr.log}`, `<phase>.partial.json` and `<phase>.json`
- `logs/token-usage/*.json` through `logTokenUsage` when enabled
- no PostgreSQL access

## Imports
- `src/lib/cli-runtime.mjs` (`cliSpec`, `processRun`, `temporaryWorker`)
- `src/eval/_evaluation-plan.mjs` (`RESEARCH_SECTIONS`, `companyFreshness`)
- `src/lib/_token-debug.mjs` (`logTokenUsage`)
- `src/lib/_cached-jd.mjs` (`findCachedJD`)
- `src/lib/_prompt-templates.mjs` (`renderPrompt`, `extractWorksheetJSON`, `sameShape`)
- `src/lib/root.mjs`
- `src/lib/_task-status.mjs` (`reportPhase`)

## Used by
- `src/eval/evaluate-jobs.mjs`, `src/eval/test-evaluation-cli.mjs`, `src/eval/test-evaluation-worksheet.mjs`
- `dashboard/internal/data/career.go` parses the report layout produced by `render` (referenced in a comment)

## Counterpart prompt(s)
- none (renders `eval/company-research.md` and `eval/repair.md` on behalf of the launcher; see `documentation/src/eval/evaluate-jobs.md`)

## Notes
- Exports: `loadRubric`, `dimensions`, `weights`, `titles` (the six block headings A-F), `read`, `hash`, `put`, `json`, `slug`, `isManualJD`, `cachedJD`, `researchNeeded`, `validateGate`, `validateResearch`, `mergeResearch`, `researchSection`, `validateEvaluation`, `render`, `companyPrompt`, `invoke`, `pool`. `isManualJD` returns true only when the JD YAML frontmatter has the exact generated `source: manual-paste` marker; matching text in the JD body cannot bypass eligibility.
- `validateEvaluation` requires exactly 8 ordered scores matching the rubric order, scores 1-5 with evidence, blocks A-F without `## ` headings, and 15-22 keywords. `validateResearch` requires every requested section (null = unavailable) and, for non-null sections, an `http(s)` URL plus a four-digit year or an explicit UNKNOWN/UNAVAILABLE date.
- `render` computes the weighted score clamped to 1-5 (one decimal) and the Score Breakdown table; gate FAIL/MISSING renders a stub with "Not assessed" and status Discarded.
- `mergeResearch` replaces or appends `## <section>` blocks with a `**Last updated:**` line and migrates a legacy file-level date into the hiring-signals section.
- `invoke`: checkpoint keyed by sha256 of prompt+provider+config+research (+ `version: 4`), so identical calls return the cached validated value; each attempt runs in a fresh `temporaryWorker` folder; codex gets `--json`; research web tools only on attempt 0 (repairs run without tools); JSON fences are stripped; with a contract the answer must preserve the worksheet shape (`sameShape`); partial research sections accumulate across attempts; up to `max_repairs` retries append `repair.md`; after the last failure a partially valid research result is still returned.
- `pool` runs `fn` over items with bounded concurrency and rethrows the first rejection.
- Observation: `cachedJD` is exported and tested, but the launcher reads JDs from PostgreSQL rather than through this helper.
