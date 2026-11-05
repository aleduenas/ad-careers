# llm/prompts/eval/market-research.md

**Kind:** worker prompt (evaluation, role market research, web tools allowed)

**Purpose:** Collects current Canadian salary benchmarks and demand evidence for one role
(one section, `Role market`), citing URLs and dates and distinguishing CAD, base pay and
total compensation. Runs once per job that passed the gate, before `evaluate.md`.

**Substituted by:** `src/eval/evaluate-jobs.mjs` via
`renderPrompt(root,'eval/market-research.md',...)`, sent through `invoke()` with
`research=true` and the research model configuration. The same prompt is rendered with
synthetic values by `--smoke-research` to verify that web tools work.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{COMPANY}}` | `jobs.company` |
| `{{ROLE}}` | `jobs.role` |
| `{{LOCATION}}` | the `location` value returned by `gate.md`, or `UNKNOWN` |
| `{{DATE}}` | run date `YYYY-MM-DD` |

**Expected response:** the JSON worksheet with `limitations` and
`sections."Role market".evidence[]`. Checked by `sameShape`, decoded by
`researchDecode(['Role market'])` and validated by `validateResearch(v,['Role market'])`, with
the `partial: true` contract (see `company-research.md` for the shared mechanics).

**Notes:**

- Two different consumers read the result. The full decoded section becomes the
  `market research` row of Block D in the report. Separately, only the evidence paragraphs that
  contain a currency figure are joined into `{{MARKET_SALARY_CONTEXT}}` for `evaluate.md`, and
  even that is replaced by a fixed sentence when the JD already advertises a band (regex on
  `CAD`, `USD`, `$`, `€`, `£` followed by digits).
- Failure is tolerated: the launcher substitutes `Role market research unavailable: <error>` and
  continues to evaluation.
- Input index: [`llm/prompts/eval/INDEX.md`](../../../../llm/prompts/eval/INDEX.md).
