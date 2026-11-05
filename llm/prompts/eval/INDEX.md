# Evaluation prompt input index

Each item below maps a template placeholder to the value inserted at runtime by
[`src/eval/evaluate-jobs.mjs`](../../../src/eval/evaluate-jobs.mjs). Every rendered
prompt is archived in `logs/evaluation/<run-id>/`; the exact static prompt
sources are archived below that run's `prompt-sources/` directory.

## [`company-research.md`](company-research.md)

| Placeholder | Value supplied at runtime | Source |
|---|---|---|
| `{{COMPANY}}` | Employer name | Selected PostgreSQL `jobs.company` record |
| `{{EMPLOYER_URLS}}` | Comma-separated posting URLs for eligible roles at that employer | PostgreSQL `jobs.url` records in the current run |
| `{{EXISTING_CACHE}}` | Existing cached company research, or `No existing cache` | `company-info/<company-slug>.md` |
| `{{DATE}}` | Evaluation-run date (`YYYY-MM-DD`) | `src/eval/evaluate-jobs.mjs` at run creation |

## [`evaluate.md`](evaluate.md)

| Placeholder | Value supplied at runtime | Source |
|---|---|---|
| `{{SCORING_RUBRIC}}` | Eight-dimension scoring table | [`scoring.md`](scoring.md) |
| `{{CANDIDATE_FACTS}}` | Compact canonical candidate facts | `llm/compacted/cv-compact.md` |
| `{{TARGETING}}` | Target roles, location/compensation policy and related candidate preferences | `llm/compacted/candidate-targeting.md` |
| `{{COMPANY}}` | Employer name | Selected PostgreSQL `jobs.company` record |
| `{{ROLE}}` | Posting title | Selected PostgreSQL `jobs.role` record |
| `{{DATE}}` | Evaluation-run date (`YYYY-MM-DD`) | `src/eval/evaluate-jobs.mjs` at run creation |
| `{{JOB_DESCRIPTION}}` | Cached full JD | PostgreSQL `job_descriptions.content`, sourced from `jds/<company>/<role>.md` |
| `{{MARKET_SALARY_CONTEXT}}` | Fresh role-market evidence only when the JD has no detected advertised compensation band | Result of [`market-research.md`](market-research.md) for this role |
| `{{SCAN_HISTORY}}` | Up to 30 previous sightings of the same company/title or URL | PostgreSQL `scan_history` rows |

## [`gate.md`](gate.md)

| Placeholder | Value supplied at runtime | Source |
|---|---|---|
| `{{CACHED_JD}}` | Cached full JD, or `No cached JD` | PostgreSQL `job_descriptions.content` |

## [`market-research.md`](market-research.md)

| Placeholder | Value supplied at runtime | Source |
|---|---|---|
| `{{COMPANY}}` | Employer name | Selected PostgreSQL `jobs.company` record |
| `{{ROLE}}` | Posting title | Selected PostgreSQL `jobs.role` record |
| `{{LOCATION}}` | Location extracted by the eligibility gate | `location` field returned by [`gate.md`](gate.md) |
| `{{DATE}}` | Evaluation-run date (`YYYY-MM-DD`) | `src/eval/evaluate-jobs.mjs` at run creation |

## [`repair.md`](repair.md)

This prompt is appended only after a worksheet validation failure. It receives no
new research or candidate facts.

| Placeholder | Value supplied at runtime | Source |
|---|---|---|
| `{{VALIDATION_ERRORS}}` | Validation failure messages | Local worksheet parser and validator |
| `{{PREVIOUS_RESPONSES}}` | Invalid prior response; for research, all retained responses | Current worker attempt archive |

## [`scoring.md`](scoring.md)

This rubric has no placeholders. Its complete content is inserted into
`{{SCORING_RUBRIC}}` in [`evaluate.md`](evaluate.md).
