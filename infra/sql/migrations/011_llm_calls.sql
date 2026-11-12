-- One row per launcher LLM call (provider CLI run through src/lib/cli-runtime.mjs), with the
-- normalized token counts. Accounting only: nothing here reads or writes jobs.status, evaluations,
-- job_status_events or job_descriptions. job_id is nullable (company research and intake have no
-- job); run_id is the browser run id when the launcher was started from the dashboard and carries
-- no foreign key, so a missing run row can never lose an accounting row.
-- model is the real model id the provider reported (the model with the most output when several
-- were used), falling back to the requested alias; requested_model keeps the alias asked for.
-- input_tokens is the uncached input only; cache_read_tokens and cache_write_tokens are separate.
-- output_tokens already includes reasoning_tokens (both providers bill reasoning as output).
CREATE TABLE llm_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  called_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL CHECK (provider IN ('claude','codex')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  requested_model text CHECK (requested_model IS NULL OR length(requested_model) BETWEEN 1 AND 120),
  function text NOT NULL CHECK (function ~ '^[A-Za-z][A-Za-z0-9]{0,39}$'),
  job_id bigint REFERENCES jobs(id) ON DELETE SET NULL,
  run_id uuid,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens bigint NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  reported_cost_usd numeric CHECK (reported_cost_usd IS NULL OR reported_cost_usd >= 0),
  usage_missing boolean NOT NULL DEFAULT false,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  exit_code integer,
  source text NOT NULL DEFAULT 'live' CHECK (source IN ('live','backfill')),
  log_ref text CHECK (log_ref IS NULL OR (length(log_ref) <= 400 AND log_ref NOT LIKE '%..%')),
  CHECK (NOT usage_missing OR (input_tokens = 0 AND cache_read_tokens = 0 AND cache_write_tokens = 0
    AND output_tokens = 0 AND reasoning_tokens = 0)),
  CHECK (reasoning_tokens <= output_tokens)
);
-- Idempotent backfill and live-then-backfill: one row per log file.
CREATE UNIQUE INDEX llm_calls_log_ref_key ON llm_calls (log_ref) WHERE log_ref IS NOT NULL;
CREATE INDEX llm_calls_called_idx ON llm_calls (called_at DESC);
CREATE INDEX llm_calls_job_idx ON llm_calls (job_id, called_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX llm_calls_model_idx ON llm_calls (model, called_at DESC);
