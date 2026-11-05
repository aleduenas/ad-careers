# src/eval/test-evaluation-cli.mjs

**Kind:** test
**Purpose:** Unit tests for the evaluation helpers (validation, rendering, rubric loading, manual-JD detection, cache merge, cached-JD lookup) plus an optional end-to-end launcher integration test that runs a fixture copy of `evaluate-jobs.mjs` against a throwaway PostgreSQL schema with a mocked provider CLI. It proves dry-run and prepare-only never touch the database, manual intake skips only the location-gate call and still receives a scored evaluation, resume retries only failed jobs, and candidate facts never reach gate or research prompts.

## Run
`node src/eval/test-evaluation-cli.mjs`. Without `TEST_DATABASE_URL` it runs the unit part and prints `SKIPPED launcher integration`. With `TEST_DATABASE_URL` (database name must match `career_ops_test_*`) it creates schema `eval_<uuid>`, applies `infra/sql/migrations/*.sql`, runs the launcher and drops the schema. `EVAL_TEST_DEBUG=1` prints intermediate DB state.

## Reads
- `llm/prompts/eval/scoring.md` (via import); `infra/sql/migrations/*.sql`; `src/` and `llm/prompts/` (copied into the fixture)
- env: `TEST_DATABASE_URL`, `EVAL_TEST_DEBUG`
- PostgreSQL (test schema only): `jobs`, `evaluations`, `sync_job_description(...)`

## Writes
- `logs/tests/evaluation/run-<tmp>/` fixture tree (config, synthetic `llm/compacted/*`, `data/jds/*`, `mock-cli.mjs`, `calls.jsonl`, `allow-retry`, launcher output), removed in `finally`
- a temporary rubric directory under the OS temp folder for the weight-sum check
- PostgreSQL test schema created and dropped; nothing outside it

## Imports
- `src/eval/_evaluation-cli.mjs`
- `src/lib/root.mjs`
- `pg` (direct client for schema management)

## Used by
- `src/test-all.mjs` (discovery), `src/helpers/db-test.mjs`, `.github/workflows/database.yml`

## Counterpart prompt(s)
- none

## Notes
- The mock CLI (`mock-cli.mjs`, loaded with `NODE_OPTIONS=--import`) intercepts `child_process.spawn` for the `fixture-claude` command and answers by matching the opening words of each prompt (`Determine location eligibility`, `Research only this employer`, `Research current Canadian`, `Evaluate the supplied`, `REPAIR ONLY`); changing a prompt file's first sentence breaks this matching.
- Scenarios: 5 initially selected jobs covering PASS, provider failure then retry, missing JD, REVIEW and FAIL; expects 3 evaluations after the first resume and exit code 2; a second resume adds exactly one evaluation call and no duplicate completion. A separate manual-paste US-only fixture proves the location gate is not called while evaluation still completes; a new company with two roles triggers one research call plus one no-web-tools repair.
- Asserts worker cwd stays under `logs/workers/` and that the synthetic candidate text never appears in gate or research prompts.
- Cleanup refuses to delete anything outside `logs/tests/evaluation/run-*`.
