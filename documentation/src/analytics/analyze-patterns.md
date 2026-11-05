# src/analytics/analyze-patterns.mjs

**Kind:** launcher
**Purpose:** Rejection-pattern analysis over the pipeline. It loads every non-Pending job from PostgreSQL, parses each linked evaluation report for archetype, seniority, remote policy, team size, score breakdown and gap table, classifies outcomes (positive, negative, pending), and emits a funnel, score comparison, archetype and remote-policy breakdowns, blocker frequencies, tech-stack gaps, a suggested score threshold and recommendations. Rejected, Discarded and Ghosted are negative outcomes.

## Run
`node src/analytics/analyze-patterns.mjs [--summary] [--min-threshold N]`
- default: full result as JSON on stdout
- `--summary`: human-readable tables
- `--min-threshold N`: minimum number of jobs beyond `Evaluated` required before analysing (default 5); below it the script prints an error object and exits 1

## Reads
- PostgreSQL: `jobs` where `status <> 'Pending'` (all columns, `source_date` as `date`)
- `data/evaluations/<report>.md` for each job with a `report_path` (see Notes)

## Writes
- none

## Imports
- `src/lib/_database.mjs` (`query`)
- `src/lib/root.mjs`

## Used by
- none found (no package.json alias, workflow or dashboard call); run by hand

## Notes
- Report parsing works on markdown tables with English or Spanish row labels (Archetype/Arquetipo, Seniority/Nivel, Remote/Remoto, Team/Equipo, Comp/Salario, Domain/Dominio) and score rows `CV Match`, `North Star`, `Comp`, `Cultural`, `Red flags`, `Global`; the gap table is recognised by a `| Gap | Severity |` header.
- The recommendations are heuristics (geo blocker at 20%+, stack mismatch at 15%+, lowest positive score above 3.0, best archetype and worst remote policy with at least 2 samples); they are printed, not applied anywhere.
