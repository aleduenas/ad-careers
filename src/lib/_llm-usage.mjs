// Token accounting for launcher LLM calls. parseUsage normalizes a provider CLI's stdout,
// recordCall writes one llm_calls row (migration 011), readCalls and aggregateCalls are the read
// side used by the Cost API. A failure to record never fails the launcher (recordCallSafe).
// Normalized counts: inputTokens is uncached input only, cacheReadTokens and cacheWriteTokens are
// separate, outputTokens already includes reasoningTokens (both providers bill reasoning as output).
import { relative, isAbsolute, sep } from 'node:path';

export const FUNCTIONS = [
  'evaluation',
  'gate',
  'market',
  'companyResearch',
  'cv',
  'coverLetter',
  'intake',
  'smoke',
];
export const PROVIDERS = ['claude', 'codex'];
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const finite = value => Number.isFinite(value) && value >= 0;
const count = value => (finite(value) ? Math.round(value) : 0);

function parseLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Returns the normalized token record, or null when the stdout carries no usable counters.
export function parseUsage(provider, stdoutText) {
  const text = String(stdoutText ?? '');
  if (provider === 'claude') {
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      return null;
    }
    const usage = envelope?.usage;
    const models = Object.values(envelope?.modelUsage || {});
    const reasoning = count(usage?.output_tokens_details?.thinking_tokens);
    const cost = finite(envelope?.total_cost_usd) ? envelope.total_cost_usd : null;
    const durationMs = finite(envelope?.duration_ms) ? Math.round(envelope.duration_ms) : null;
    // modelUsage covers every model the CLI used (sub-agents included); prefer it when complete.
    if (
      models.length &&
      models.every(m =>
        [m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens].every(
          finite,
        ),
      )
    ) {
      const sum = key => models.reduce((n, m) => n + m[key], 0);
      const output = count(sum('outputTokens'));
      const primary = Object.entries(envelope.modelUsage).sort(
        (a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0),
      )[0]?.[0];
      return {
        model: primary || null,
        inputTokens: count(sum('inputTokens')),
        cacheReadTokens: count(sum('cacheReadInputTokens')),
        cacheWriteTokens: count(sum('cacheCreationInputTokens')),
        outputTokens: output,
        reasoningTokens: Math.min(reasoning, output),
        reportedCostUsd: cost,
        durationMs,
      };
    }
    if (!usage || !finite(usage.input_tokens) || !finite(usage.output_tokens)) return null;
    return {
      model: null,
      inputTokens: count(usage.input_tokens),
      cacheReadTokens: count(usage.cache_read_input_tokens),
      cacheWriteTokens: count(usage.cache_creation_input_tokens),
      outputTokens: count(usage.output_tokens),
      reasoningTokens: Math.min(reasoning, count(usage.output_tokens)),
      reportedCostUsd: cost,
      durationMs,
    };
  }
  if (provider === 'codex') {
    const done = parseLines(text)
      .filter(event => event.type === 'turn.completed')
      .at(-1);
    const usage = done?.usage;
    if (!usage || !finite(usage.input_tokens) || !finite(usage.output_tokens)) return null;
    // Codex input_tokens includes the cached share; store only the uncached remainder.
    const cacheRead = count(usage.cached_input_tokens);
    const cacheWrite = count(usage.cache_write_input_tokens);
    const output = count(usage.output_tokens);
    return {
      model: null,
      inputTokens: Math.max(0, count(usage.input_tokens) - cacheRead - cacheWrite),
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: output,
      reasoningTokens: Math.min(count(usage.reasoning_output_tokens), output),
      reportedCostUsd: null,
      durationMs: null,
    };
  }
  return null;
}

async function defaultQuery(sql, args) {
  const { query } = await import('./_database.mjs');
  return query(sql, args);
}

export function validateRow(row) {
  if (!PROVIDERS.includes(row.provider))
    throw new Error('llm call provider must be claude or codex');
  if (typeof row.function !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(row.function))
    throw new Error('llm call function label is invalid');
  if (typeof row.model !== 'string' || !row.model.trim() || row.model.length > 120)
    throw new Error('llm call model is invalid');
}

// Writes one llm_calls row. Without parsable usage (usage null) the row is zero with
// usage_missing = true. Returns the stored row, or null when log_ref already exists.
export async function recordCall(row, { query = defaultQuery } = {}) {
  validateRow(row);
  const usage = row.usage ?? null;
  const jobId = row.jobId != null && /^\d+$/.test(String(row.jobId)) ? String(row.jobId) : null;
  const runId = typeof row.runId === 'string' && RUN_ID.test(row.runId) ? row.runId : null;
  const rows = await query(
    `INSERT INTO llm_calls (called_at,provider,model,requested_model,function,job_id,run_id,
       input_tokens,cache_read_tokens,cache_write_tokens,output_tokens,reasoning_tokens,
       reported_cost_usd,usage_missing,duration_ms,exit_code,source,log_ref)
     VALUES (COALESCE($1::timestamptz,now()),$2,$3,$4,$5,$6::bigint,$7::uuid,$8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18)
     ON CONFLICT (log_ref) WHERE log_ref IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      row.calledAt ?? null,
      row.provider,
      (usage?.model || row.model).trim().slice(0, 120),
      row.requestedModel ? String(row.requestedModel).trim().slice(0, 120) : null,
      row.function,
      jobId,
      runId,
      usage?.inputTokens ?? 0,
      usage?.cacheReadTokens ?? 0,
      usage?.cacheWriteTokens ?? 0,
      usage?.outputTokens ?? 0,
      usage?.reasoningTokens ?? 0,
      usage?.reportedCostUsd ?? null,
      !usage,
      row.durationMs ?? usage?.durationMs ?? null,
      Number.isInteger(row.exitCode) ? row.exitCode : null,
      row.source === 'backfill' ? 'backfill' : 'live',
      row.logRef ?? null,
    ],
  );
  return rows[0] ?? null;
}

// Hook used by processRun: parse stdout and record, never throwing into the launcher.
export async function recordCallSafe(meta, result, durationMs, options) {
  try {
    await recordCall(
      {
        provider: meta.provider,
        model: meta.model || 'unknown',
        requestedModel: meta.model || null,
        function: meta.fn,
        jobId: meta.jobId,
        runId: meta.runId ?? process.env.CAREER_RUN_ID ?? null,
        usage: parseUsage(meta.provider, result.stdout),
        durationMs,
        exitCode: result.code,
        source: 'live',
        logRef: meta.logRef ?? null,
      },
      options,
    );
  } catch (error) {
    process.stderr.write('LLM usage recording failed: ' + error.message + '\n');
  }
}

// Repo-relative POSIX path for a log_ref.
export function logRefOf(root, path) {
  const rel = isAbsolute(path) ? relative(root, path) : path;
  return rel.split(sep).join('/');
}

export const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };

function sinceOf(range, now = new Date()) {
  if (!Object.hasOwn(RANGES, range)) throw new Error('range must be 7d, 30d, 90d or all');
  const days = RANGES[range];
  return days == null ? null : new Date(now.getTime() - days * 86400000);
}

const sums = p => `count(*)::int AS calls,
  COALESCE(sum(${p}input_tokens),0)::bigint AS input_tokens,
  COALESCE(sum(${p}cache_read_tokens),0)::bigint AS cache_read_tokens,
  COALESCE(sum(${p}cache_write_tokens),0)::bigint AS cache_write_tokens,
  COALESCE(sum(${p}output_tokens),0)::bigint AS output_tokens,
  COALESCE(sum(${p}reasoning_tokens),0)::bigint AS reasoning_tokens,
  count(*) FILTER (WHERE ${p}usage_missing)::int AS missing_calls`;
const order = p =>
  `sum(${p}input_tokens+${p}cache_read_tokens+${p}cache_write_tokens+${p}output_tokens) DESC`;

const num = v => Number(v);
function shape(row) {
  return {
    calls: row?.calls ?? 0,
    inputTokens: num(row?.input_tokens ?? 0),
    cacheReadTokens: num(row?.cache_read_tokens ?? 0),
    cacheWriteTokens: num(row?.cache_write_tokens ?? 0),
    outputTokens: num(row?.output_tokens ?? 0),
    reasoningTokens: num(row?.reasoning_tokens ?? 0),
    missingCalls: row?.missing_calls ?? 0,
  };
}

// Totals and breakdowns for the Cost page. Empty data gives zeros and empty lists. byDay has one
// row per day and model so a price view can cost each day exactly.
export async function aggregateCalls({ range = '30d', query = defaultQuery, now } = {}) {
  const since = sinceOf(range, now);
  const args = [since];
  const where = 'WHERE ($1::timestamptz IS NULL OR called_at >= $1::timestamptz)';
  const [totals] = await query(`SELECT ${sums('')} FROM llm_calls ${where}`, args);
  const byModel = await query(
    `SELECT provider, model, ${sums('')} FROM llm_calls ${where} GROUP BY provider, model
     ORDER BY ${order('')}, model`,
    args,
  );
  const byFunction = await query(
    `SELECT function, ${sums('')} FROM llm_calls ${where} GROUP BY function
     ORDER BY ${order('')}, function`,
    args,
  );
  const byJob = await query(
    `SELECT c.job_id, j.company, j.role, ${sums('c.')}
     FROM llm_calls c LEFT JOIN jobs j ON j.id = c.job_id
     WHERE ($1::timestamptz IS NULL OR c.called_at >= $1::timestamptz) AND c.job_id IS NOT NULL
     GROUP BY c.job_id, j.company, j.role
     ORDER BY ${order('c.')}, c.job_id LIMIT 100`,
    args,
  );
  const byDay = await query(
    `SELECT to_char(called_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, provider, model, ${sums('')}
     FROM llm_calls ${where} GROUP BY 1, provider, model ORDER BY 1, provider, model`,
    args,
  );
  return {
    range,
    since: since ? since.toISOString() : null,
    totals: shape(totals),
    byModel: byModel.map(r => ({ provider: r.provider, model: r.model, ...shape(r) })),
    byFunction: byFunction.map(r => ({ function: r.function, ...shape(r) })),
    byJob: byJob.map(r => ({
      jobId: num(r.job_id),
      company: r.company ?? null,
      role: r.role ?? null,
      ...shape(r),
    })),
    byDay: byDay.map(r => ({ day: r.day, provider: r.provider, model: r.model, ...shape(r) })),
  };
}

// Newest first. limit defaults to 100 and is capped at 500.
export async function readCalls({
  range = '30d',
  jobId = null,
  limit = 100,
  query = defaultQuery,
  now,
} = {}) {
  const since = sinceOf(range, now);
  const cap = Math.min(500, Math.max(1, Number.isInteger(limit) ? limit : 100));
  if (jobId != null && !/^\d+$/.test(String(jobId))) throw new Error('jobId must be numeric');
  const rows = await query(
    `SELECT c.id, c.called_at, c.provider, c.model, c.requested_model, c.function, c.job_id, c.run_id, j.company, j.role,
       c.input_tokens, c.cache_read_tokens, c.cache_write_tokens, c.output_tokens,
       c.reasoning_tokens, c.reported_cost_usd, c.usage_missing, c.duration_ms, c.source
     FROM llm_calls c LEFT JOIN jobs j ON j.id = c.job_id
     WHERE ($1::timestamptz IS NULL OR c.called_at >= $1::timestamptz)
       AND ($2::bigint IS NULL OR c.job_id = $2::bigint)
     ORDER BY c.called_at DESC, c.id DESC LIMIT $3`,
    [since, jobId == null ? null : String(jobId), cap],
  );
  return rows.map(r => ({
    id: num(r.id),
    calledAt: new Date(r.called_at).toISOString(),
    provider: r.provider,
    model: r.model,
    requestedModel: r.requested_model ?? null,
    function: r.function,
    jobId: r.job_id == null ? null : num(r.job_id),
    runId: r.run_id ?? null,
    company: r.company ?? null,
    role: r.role ?? null,
    inputTokens: num(r.input_tokens),
    cacheReadTokens: num(r.cache_read_tokens),
    cacheWriteTokens: num(r.cache_write_tokens),
    outputTokens: num(r.output_tokens),
    reasoningTokens: num(r.reasoning_tokens),
    reportedCostUsd: r.reported_cost_usd == null ? null : num(r.reported_cost_usd),
    usageMissing: r.usage_missing,
    durationMs: r.duration_ms == null ? null : num(r.duration_ms),
    source: r.source,
  }));
}

// Unlimited count of the calls readCalls would list for the same filter.
export async function countCalls({ range = '30d', jobId = null, query = defaultQuery, now } = {}) {
  const since = sinceOf(range, now);
  if (jobId != null && !/^\d+$/.test(String(jobId))) throw new Error('jobId must be numeric');
  const [row] = await query(
    `SELECT count(*)::int AS n FROM llm_calls c
     WHERE ($1::timestamptz IS NULL OR c.called_at >= $1::timestamptz)
       AND ($2::bigint IS NULL OR c.job_id = $2::bigint)`,
    [since, jobId == null ? null : String(jobId)],
  );
  return row?.n ?? 0;
}

// One row per (UTC day, provider, model, function, job) so the API can build every breakdown and
// price each group by model. No LIMIT. reportedCostUsd sums only the calls that carry a reported
// cost; reportedCostCalls says how many did.
export async function cubeCalls({ range = '30d', query = defaultQuery, now } = {}) {
  const since = sinceOf(range, now);
  const rows = await query(
    `SELECT to_char(c.called_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, c.provider, c.model,
       c.function, c.job_id, j.company, j.role, ${sums('c.')},
       COALESCE(sum(c.reported_cost_usd),0)::float8 AS reported_cost_usd,
       count(c.reported_cost_usd)::int AS reported_cost_calls,
       (count(*) FILTER (WHERE c.reported_cost_usd IS NULL))::int AS unreported_calls,
       COALESCE(sum(c.input_tokens) FILTER (WHERE c.reported_cost_usd IS NULL),0)::bigint AS unreported_input,
       COALESCE(sum(c.cache_read_tokens) FILTER (WHERE c.reported_cost_usd IS NULL),0)::bigint AS unreported_cache_read,
       COALESCE(sum(c.cache_write_tokens) FILTER (WHERE c.reported_cost_usd IS NULL),0)::bigint AS unreported_cache_write,
       COALESCE(sum(c.output_tokens) FILTER (WHERE c.reported_cost_usd IS NULL),0)::bigint AS unreported_output
     FROM llm_calls c LEFT JOIN jobs j ON j.id = c.job_id
     WHERE ($1::timestamptz IS NULL OR c.called_at >= $1::timestamptz)
     GROUP BY 1, c.provider, c.model, c.function, c.job_id, j.company, j.role
     ORDER BY 1, c.provider, c.model, c.function, c.job_id`,
    [since],
  );
  return {
    since: since ? since.toISOString() : null,
    rows: rows.map(r => ({
      day: r.day,
      provider: r.provider,
      model: r.model,
      function: r.function,
      jobId: r.job_id == null ? null : num(r.job_id),
      company: r.company ?? null,
      role: r.role ?? null,
      ...shape(r),
      reportedCostUsd: num(r.reported_cost_usd),
      reportedCostCalls: r.reported_cost_calls,
      unreported: {
        calls: r.unreported_calls,
        inputTokens: num(r.unreported_input),
        cacheReadTokens: num(r.unreported_cache_read),
        cacheWriteTokens: num(r.unreported_cache_write),
        outputTokens: num(r.unreported_output),
      },
    })),
  };
}
