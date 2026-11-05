# src/eval/_evaluation-plan.mjs

**Kind:** shared module
**Purpose:** Declares the two company-research sections the pipeline maintains and decides whether each is fresh in a company cache file. It is the single place that defines the 90-day freshness window used to skip company research.

## Run
Not runnable; imported by other modules.

## Reads
- the company cache file passed as `path` (normally `data/company-info/<slug>.md`); a missing file counts as empty

## Writes
- none

## Imports
- none

## Used by
- `src/eval/evaluate-jobs.mjs` (`RESEARCH_SECTIONS`)
- `src/eval/_evaluation-cli.mjs` (`RESEARCH_SECTIONS`, `companyFreshness` inside `researchNeeded`)

## Counterpart prompt(s)
- none (the section names must equal the `sections` keys of the worksheet in `llm/prompts/eval/company-research.md`; `src/eval/test-evaluation-worksheet.mjs` asserts this)

## Notes
- `RESEARCH_SECTIONS = ['Company Reputation & Culture', 'Layoffs & Hiring Signals']`.
- `companyFreshness(path, now)` returns `{section: boolean}`; a section is fresh when its `## <section>` block has non-empty evidence (ignoring the `**Last updated:**` line) and its date is 0-89 days old. For the hiring-signals section only, a legacy file-level `**Last updated:**` (before the first `## `) is accepted as the date.
- A future-dated section (`age < 0`) counts as stale.
