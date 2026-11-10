# src/server/jobs-compensation.mjs

**Authority:** the source file; the compensation band wording comes from the evaluation report
contract in `llm/prompts/eval/` (the `**Compensation band:**` line, or the historical `**Comp** |`
table cell).

Exports `readReportCompensation(row, rootDir)`. For a job row carrying a `report_path`, it checks
the path with `jobs-paths.mjs` (allowed roots `data/evaluations` and `output`), refuses reports
over 1 MiB, and projects the band line into `{text, state}`:

| State | Meaning |
|---|---|
| `missing` | no report path, file missing, or band is `Unknown…` / `Not assessed` |
| `invalid` | path unsafe, file oversized or unreadable, no band line, or control characters |
| `report` | a usable band; `text` is the trimmed band, capped at 300 characters |

The caller in `jobs-read.mjs` decides when a manual salary pair wins over the report band and
labels Pending jobs `notEvaluated`. The module never writes, caches or returns file paths.

**Tests:** `node --test src/server/test-jobs-read.mjs` covers band, unknown, missing and unsafe
cases with synthetic report files.
