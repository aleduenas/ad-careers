import * as usage from '../lib/_llm-usage.mjs';
import { estimateUsd, findPrice, loadPrices, priceIndex, priceKey } from '../lib/llm-prices.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

// Read-only Cost API service (D084). Token counts from the llm_calls table are the authority;
// estimatedUsd prices the same counts at the public API prices in config/llm-prices.json.

const RANGES = new Set(['7d', '30d', '90d', 'all']);
const DEFAULT_RANGE = '30d';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_JOBS = 100;

function requestError(field) {
  const error = new Error('Query parameter is invalid.');
  error.statusCode = 400;
  error.publicCode = 'INVALID_REQUEST';
  error.fields = { [field]: 'Invalid value.' };
  return error;
}

// Strict query validation. `raw` holds string values only (the route already rejects unknown or
// repeated keys). Returns normalized values with defaults applied.
export function normalizeCostQuery(raw = {}, { allowed }) {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw requestError(key);
  const range = raw.range === undefined ? DEFAULT_RANGE : raw.range;
  if (!RANGES.has(range)) throw requestError('range');
  const result = { range };
  if (allowed.includes('jobId')) {
    if (raw.jobId !== undefined && !/^[1-9][0-9]{0,17}$/.test(raw.jobId))
      throw requestError('jobId');
    result.jobId = raw.jobId ?? null;
  }
  if (allowed.includes('limit')) {
    if (raw.limit !== undefined && !/^[1-9][0-9]{0,3}$/.test(raw.limit))
      throw requestError('limit');
    const limit = raw.limit === undefined ? DEFAULT_LIMIT : Number(raw.limit);
    if (limit > MAX_LIMIT) throw requestError('limit');
    result.limit = limit;
  }
  return result;
}

const emptyTokens = () => ({
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});

const totalOf = t => t.inputTokens + t.cachedInputTokens + t.cacheWriteTokens + t.outputTokens;

// Accumulates leaf rows (one provider/model each) so USD is priced per model, then rolled up.
function newGroup(extra = {}) {
  return { ...extra, ...emptyTokens(), usd: 0, priced: 0, unpriced: 0, unpricedCalls: 0 };
}

// A row's calls split into those with a CLI-reported cost (summed as is) and the rest, whose
// token sums the storage returns separately (row.unreported) and the table prices.
function addLeaf(group, leaf, price, reported, unreported) {
  group.calls += leaf.calls;
  group.inputTokens += leaf.inputTokens;
  group.cachedInputTokens += leaf.cachedInputTokens;
  group.cacheWriteTokens += leaf.cacheWriteTokens;
  group.outputTokens += leaf.outputTokens;
  group.reasoningTokens += leaf.reasoningTokens;
  if (reported.calls > 0) {
    group.usd += reported.usd;
    group.priced += 1;
  }
  if (unreported.calls > 0) {
    const usd = estimateUsd(unreported.tokens, price, unreported.calls);
    if (usd === null) {
      group.unpriced += 1;
      group.unpricedCalls += unreported.calls;
    } else {
      group.usd += usd;
      group.priced += 1;
    }
  }
}

// estimatedUsd: sum of the priced leaves; null when the group has calls and none are priced;
// 0 when it has no calls. Unpriced models are listed separately, so a partial sum is explicit.
function finish(group) {
  const { usd, priced, unpriced, ...rest } = group;
  return {
    ...rest,
    totalTokens: totalOf(group),
    estimatedUsd: priced === 0 && unpriced > 0 ? null : Math.round(usd * 1e6) / 1e6,
  };
}

const byTotalDesc = (a, b) => b.totalTokens - a.totalTokens;

function leafOf(row) {
  return {
    calls: Number(row.calls) || 0,
    inputTokens: Number(row.inputTokens) || 0,
    cachedInputTokens: Number(row.cacheReadTokens) || 0,
    cacheWriteTokens: Number(row.cacheWriteTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    reasoningTokens: Number(row.reasoningTokens) || 0,
  };
}

// Pure roll-up of cube rows (day, provider, model, function, jobId, company, role + token sums).
export function summarize({ range, since, until, rows, prices }) {
  const index = priceIndex(prices);
  const totals = newGroup();
  const models = new Map();
  const functions = new Map();
  const jobs = new Map();
  const days = new Map();
  const unpriced = new Set();
  const bucket = (map, key, extra) => {
    if (!map.has(key)) map.set(key, newGroup(extra));
    return map.get(key);
  };
  for (const row of rows) {
    const leaf = leafOf(row);
    if (leaf.calls === 0) continue;
    const price = findPrice(index, row.provider, row.model);
    const reported = {
      usd: Number(row.reportedCostUsd) || 0,
      calls: Number(row.reportedCostCalls) || 0,
    };
    const rest = row.unreported ?? {};
    const unreported = {
      calls: Number(rest.calls) || 0,
      tokens: {
        inputTokens: Number(rest.inputTokens) || 0,
        cachedInputTokens: Number(rest.cacheReadTokens) || 0,
        cacheWriteTokens: Number(rest.cacheWriteTokens) || 0,
        outputTokens: Number(rest.outputTokens) || 0,
      },
    };
    if (!price && unreported.calls > 0) unpriced.add(`${row.provider}/${row.model}`);
    addLeaf(totals, leaf, price, reported, unreported);
    addLeaf(
      bucket(models, priceKey(row.provider, row.model), {
        provider: row.provider,
        model: row.model,
      }),
      leaf,
      price,
      reported,
      unreported,
    );
    addLeaf(
      bucket(functions, row.function, { function: row.function }),
      leaf,
      price,
      reported,
      unreported,
    );
    addLeaf(bucket(days, row.day, { day: row.day }), leaf, price, reported, unreported);
    if (row.jobId !== null && row.jobId !== undefined) {
      const jobId = String(row.jobId);
      addLeaf(
        bucket(jobs, jobId, { jobId, company: row.company ?? null, role: row.role ?? null }),
        leaf,
        price,
        reported,
        unreported,
      );
    }
  }
  const list = map => [...map.values()].map(finish);
  return {
    range,
    since: since ?? null,
    until,
    totals: finish(totals),
    byModel: list(models).sort(byTotalDesc),
    byFunction: list(functions).sort(byTotalDesc),
    byJob: list(jobs).sort(byTotalDesc).slice(0, MAX_JOBS),
    byDay: list(days).sort((a, b) => (a.day < b.day ? -1 : 1)),
    prices: prices.map(({ longContext: _tier, ...entry }) => entry),
    unpriced: [...unpriced].sort(),
  };
}

export function shapeCall(row, index) {
  const leaf = leafOf({ ...row, calls: 1 });
  const { calls: _calls, ...tokens } = leaf;
  return {
    id: String(row.id),
    occurredAt: row.calledAt,
    provider: row.provider,
    model: row.model,
    function: row.function,
    jobId: row.jobId === null || row.jobId === undefined ? null : String(row.jobId),
    runId: row.runId ?? null,
    ...tokens,
    totalTokens: totalOf(tokens),
    durationMs: row.durationMs ?? null,
    source: row.source,
    estimatedUsd:
      row.reportedCostUsd === null || row.reportedCostUsd === undefined
        ? estimateUsd(tokens, findPrice(index, row.provider, row.model))
        : Number(row.reportedCostUsd),
  };
}

// Maps storage failures to the existing public errors; never forwards driver text.
async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DatabaseUnavailableError || error instanceof SchemaNotReadyError)
      throw error;
    if (error?.code === '42P01' || error?.code === '42703') throw new SchemaNotReadyError();
    throw new DatabaseUnavailableError();
  }
}

// The default reader wraps the storage functions in src/lib/_llm-usage.mjs. Tests inject a reader
// with the same three methods:
//   cube({ range, now }) -> { since, rows }   rows grouped by day/provider/model/function/job
//   calls({ range, jobId, limit, now }) -> rows newest first (readCalls shape)
//   count({ range, jobId, now }) -> integer   unlimited count behind `calls`
export function createCostReader({ storage = usage } = {}) {
  return {
    cube: args => storage.cubeCalls(args),
    calls: args => storage.readCalls(args),
    count: args => storage.countCalls(args),
  };
}

export function createCostService({
  reader = createCostReader(),
  prices = loadPrices,
  now = () => new Date(),
} = {}) {
  // An invalid config/llm-prices.json is surfaced as a public error, never replaced silently.
  const loadedPrices = () => {
    const loaded = prices();
    if (loaded.error) {
      const error = new Error(
        'config/llm-prices.json could not be read. Fix or remove it, then reload.',
      );
      error.statusCode = 503;
      error.publicCode = 'PRICES_UNREADABLE';
      throw error;
    }
    return loaded;
  };
  return {
    async summary({ range = DEFAULT_RANGE } = {}) {
      const at = now();
      const list = loadedPrices().prices;
      const { since, rows } = await guarded(() => reader.cube({ range, now: at }));
      return summarize({
        range,
        since: since instanceof Date ? since.toISOString() : (since ?? null),
        until: at.toISOString(),
        rows,
        prices: list,
      });
    },
    async calls({ range = DEFAULT_RANGE, jobId = null, limit = DEFAULT_LIMIT } = {}) {
      const at = now();
      const index = priceIndex(loadedPrices().prices);
      const [rows, total] = await guarded(() =>
        Promise.all([
          reader.calls({ range, jobId, limit, now: at }),
          reader.count({ range, jobId, now: at }),
        ]),
      );
      return { range, calls: rows.map(row => shapeCall(row, index)), total: Number(total) || 0 };
    },
  };
}
