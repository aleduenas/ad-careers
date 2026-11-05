# llm/prompts/eval/company-research.md

**Kind:** worker prompt (evaluation, employer research, web tools allowed)

**Purpose:** Refreshes the two employer research sections (`Company Reputation & Culture`,
`Layoffs & Hiring Signals`) for one company using at most four searches and four fetches.
Runs once per employer per run, only for jobs that passed the gate and only when
`data/company-info/<company-slug>.md` is missing or a section is older than 90 days.

**Substituted by:** `companyPrompt()` in `src/eval/_evaluation-cli.mjs`, which calls
`renderPrompt(root,'eval/company-research.md',...)`; the launcher `src/eval/evaluate-jobs.mjs`
sends it through `invoke()` with `research=true` (system prompt `runtime/research.md`,
`WebSearch,WebFetch` allowed for Claude, `web_search="live"` for Codex) under the
`research:<company-slug>` lease.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{COMPANY}}` | `jobs.company` of the first passing job for that employer |
| `{{EMPLOYER_URLS}}` | comma-joined `jobs.url` of every passing job at that employer in the run, or `None known` |
| `{{EXISTING_CACHE}}` | current `data/company-info/<slug>.md`, or `No existing cache` |
| `{{DATE}}` | run date `YYYY-MM-DD` |

**Expected response:** the JSON worksheet (`limitations`, `sections.<name>.evidence[]` with
`fact`/`date`/`url`). `invoke()` checks `sameShape`, then `researchDecode(RESEARCH_SECTIONS)`
(`src/eval/_evaluation-worksheet.mjs`) turns each valid evidence item into
`fact (Source date/access: date; url)` paragraphs, dropping `NONE` facts and rejecting items
whose date fails `validEvidenceDate` or whose url is not `http(s)://`. `validateResearch`
then requires every requested section to be present (null means unavailable) and each body to
contain a URL and a date. The `partial: true` contract keeps good sections from an attempt
whose other sections failed, so a final repair failure can still return partial evidence.

**Notes:**

- Section names are hard-coded twice: in this prompt and in `RESEARCH_SECTIONS` in
  `src/eval/_evaluation-plan.mjs`. They must match exactly.
- `mergeResearch()` rewrites only the returned sections of the cache file as
  `## <section>` blocks headed by `**Last updated:** <date>`; `companyFreshness()` reads that
  date to decide staleness (90 days). The launcher refuses to write if the cache file changed
  while research ran.
- Research failure is not an evaluation failure: the job is still evaluated and the Block D
  and F research rows read `UNAVAILABLE`.
- Input index: [`llm/prompts/eval/INDEX.md`](../../../../llm/prompts/eval/INDEX.md).
