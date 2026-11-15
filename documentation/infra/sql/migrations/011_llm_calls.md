# 011_llm_calls.sql

**Authority:** `infra/sql/migrations/011_llm_calls.sql` and
`documentation/dashboard-migration/packages/4.7-cost.md` (D084).

Additive migration for token accounting. It creates one table and four indexes and changes
nothing that exists. It never writes to `jobs`, `evaluations`, `job_status_events` or
`job_descriptions`, and it adds no job status or task state.

## llm_calls

One row per launcher LLM call made through `src/lib/cli-runtime.mjs`. Development sessions are not
recorded.

- `provider` is `claude` or `codex`. `model` is the real model id the provider reported in its output (for Claude the `modelUsage` key with the most output tokens; other models of the same call are not stored), falling back to the requested alias (`unknown` for a backfilled Codex log). `requested_model` keeps the alias the launcher asked for and is null for backfilled rows. Both at most 120 characters. Codex events name no model today, so its `model` equals the alias; `function` is a short label such as `evaluation`,
  `gate`, `market`, `companyResearch`, `cv`, `coverLetter`, `intake` or `smoke`. The database
  checks the label's shape only, so a new launcher function needs no migration; the code list
  lives in `src/lib/_llm-usage.mjs`.
- `input_tokens` is uncached input only. `cache_read_tokens` and `cache_write_tokens` are
  separate. `output_tokens` already includes `reasoning_tokens` (both providers bill reasoning as
  output), and a CHECK keeps reasoning at or below output. All counts are non-negative.
- `usage_missing` marks a call whose stdout carried no usable counters. A CHECK forces every
  count to zero on such a row, so unknown usage is flagged rather than invented.
- `job_id` is an optional foreign key to `jobs` (`ON DELETE SET NULL`); company research and
  intake have no job. `run_id` is the browser run id when the launcher was started from the
  dashboard; it has no foreign key so a missing run row can never lose an accounting row.
- `reported_cost_usd` is the cost the Claude CLI reported, kept as evidence only. It is never the
  API-price figure the Cost page computes.
- `source` is `live` (recorded by the launcher hook) or `backfill` (imported from old logs); migration 012 adds `estimate`.
- `log_ref` is the repository-relative path of the log the row came from. A partial unique index
  makes it unique when set, which makes the backfill idempotent and lets a live row and a later
  backfill of the same log collide harmlessly (the second insert does nothing).

Indexes cover recency, per-job history and per-model recency, plus the `log_ref` uniqueness.

## Rollback (non-destructive)

Rollback is a new migration, never an edit. Nothing else references `llm_calls`, so the feature
can be retired without data loss elsewhere: ship launcher code that no longer passes the `usage`
option to `processRun` (recording is opt-in per call and its failures never fail a launcher), and
leave the table in place. To remove it entirely, stop the dashboard server, take
`pg_dump -t llm_calls` first, then ship a numbered migration that runs `DROP TABLE llm_calls`.
Job data is unaffected either way. Never apply to the personal database except through the
documented migration command (`npm run db:migrate`); `src/helpers/test-rollback-rehearsal.mjs`
does not cover this migration, and no rehearsal is needed because the table is leaf-only.
