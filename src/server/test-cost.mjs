import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { createCostReader, createCostService, normalizeCostQuery, summarize } from './cost.mjs';
import { publicSchemas } from './schemas.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const SOURCE = 'https://example.invalid/pricing, fetched 2026-01-01';
const price = (provider, model, input, cached, write, output) => ({
  provider,
  model,
  inputUsdPerMtok: input,
  cachedInputUsdPerMtok: cached,
  cacheWriteUsdPerMtok: write,
  outputUsdPerMtok: output,
  source: SOURCE,
});
const PRICES = [price('claude', 'sonnet', 3, 0.3, 3.75, 15), price('codex', 'gpt-x', 1, 0.1, 0, 8)];

const cube = (extra = {}) => {
  const row = {
    day: '2026-11-10',
    provider: 'claude',
    model: 'sonnet',
    function: 'evaluation',
    jobId: '7',
    company: 'Acme',
    role: 'Engineer',
    calls: 1,
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    outputTokens: 100_000,
    reasoningTokens: 40_000,
    ...extra,
  };
  // Without an explicit split every call is unreported (no CLI-reported cost).
  row.unreported ??= {
    calls: row.calls,
    inputTokens: row.inputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
  };
  return row;
};

const ajv = new Ajv({ strict: false });
const validate = name => {
  const check = ajv.compile(publicSchemas[name]);
  return body => {
    assert.ok(check(body), JSON.stringify(check.errors));
  };
};
const envelope = data => ({ data, meta: { requestId: 'r', observedAt: '2026-11-12T00:00:00Z' } });
const NOW = new Date('2026-11-12T12:00:00.000Z');

function service(rows, { prices = PRICES, calls = [], total = calls.length } = {}) {
  const seen = [];
  const reader = {
    cube: async args => (seen.push(['cube', args]), { since: '2026-10-13T12:00:00.000Z', rows }),
    calls: async args => (seen.push(['calls', args]), calls),
    count: async args => (seen.push(['count', args]), total),
  };
  return {
    seen,
    service: createCostService({ reader, prices: () => ({ prices }), now: () => NOW }),
  };
}

test('summary prices each model and rolls up per function, job and day', async () => {
  const { service: svc } = service([
    cube(),
    cube({ function: 'cv', day: '2026-11-11', jobId: '8', company: 'Beta', role: 'Dev', calls: 2 }),
    cube({
      provider: 'codex',
      model: 'gpt-x',
      function: 'coverLetter',
      jobId: '7',
      day: '2026-11-11',
    }),
    cube({
      provider: 'codex',
      model: 'mystery',
      function: 'intake',
      jobId: null,
      company: null,
      role: null,
    }),
  ]);
  const summary = await svc.summary({ range: '30d' });
  validate('CostSummaryResponse')(envelope(summary));
  assert.equal(summary.since, '2026-10-13T12:00:00.000Z');
  assert.equal(summary.until, NOW.toISOString());
  // sonnet: 3 + 0.3 + 3.75 + 1.5 = 8.55 per row; reasoning is inside output, never added again.
  const sonnet = summary.byModel.find(r => r.model === 'sonnet');
  assert.equal(sonnet.calls, 3);
  assert.equal(sonnet.estimatedUsd, 17.1);
  assert.equal(sonnet.reasoningTokens, 80_000);
  assert.equal(sonnet.totalTokens, 2 * 3_100_000);
  // Unpriced model: null cost, listed once, never zero.
  assert.deepEqual(summary.unpriced, ['codex/mystery']);
  assert.equal(summary.totals.unpricedCalls, 1);
  assert.equal(summary.byModel.find(r => r.model === 'mystery').unpricedCalls, 1);
  assert.equal(summary.byFunction.find(r => r.function === 'intake').unpricedCalls, 1);
  assert.equal(
    summary.byDay.reduce((n, d) => n + d.unpricedCalls, 0),
    1,
  );
  assert.equal(
    summary.byJob.reduce((n, d) => n + d.unpricedCalls, 0),
    0,
  );
  assert.equal(summary.byModel.find(r => r.model === 'sonnet').unpricedCalls, 0);
  assert.equal(summary.byModel.find(r => r.model === 'mystery').estimatedUsd, null);
  assert.equal(summary.byFunction.find(r => r.function === 'intake').estimatedUsd, null);
  // Totals sum the priced leaves only.
  assert.equal(summary.totals.calls, 5);
  assert.equal(summary.totals.estimatedUsd, 19);
  // Jobs: null job excluded, sorted by tokens, both jobs present with company and role.
  assert.deepEqual(
    summary.byJob.map(j => j.jobId),
    ['7', '8'],
  );
  assert.equal(summary.byJob[0].company, 'Acme');
  // Days ascending, one row per day.
  assert.deepEqual(
    summary.byDay.map(d => d.day),
    ['2026-11-10', '2026-11-11'],
  );
  assert.equal(summary.prices.length, 2);
});

test('empty storage gives zeros, empty lists and a null-free totals row', async () => {
  const { service: svc } = service([]);
  const summary = await svc.summary({ range: 'all' });
  validate('CostSummaryResponse')(envelope(summary));
  assert.equal(summary.totals.calls, 0);
  assert.equal(summary.totals.totalTokens, 0);
  assert.equal(summary.totals.estimatedUsd, 0);
  for (const list of ['byModel', 'byFunction', 'byJob', 'byDay', 'unpriced'])
    assert.deepEqual(summary[list], []);
});

test('no prices file makes everything unpriced with null cost', async () => {
  const { service: svc } = service([cube()], { prices: [] });
  const summary = await svc.summary({});
  assert.equal(summary.totals.estimatedUsd, null);
  assert.deepEqual(summary.unpriced, ['claude/sonnet']);
  assert.equal(summary.totals.totalTokens, 3_100_000);
});

test('since is passed through as null for all and Date values are serialized', async () => {
  const reader = {
    cube: async () => ({ since: null, rows: [] }),
    calls: async () => [],
    count: async () => 0,
  };
  const svc = createCostService({ reader, prices: () => ({ prices: [] }), now: () => NOW });
  assert.equal((await svc.summary({ range: 'all' })).since, null);
  reader.cube = async () => ({ since: new Date('2026-01-01T00:00:00Z'), rows: [] });
  assert.equal((await svc.summary({ range: '7d' })).since, '2026-01-01T00:00:00.000Z');
});

test('byJob is capped at 100 rows, largest first', () => {
  const rows = Array.from({ length: 130 }, (_, i) =>
    cube({ jobId: String(i + 1), inputTokens: i + 1, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  );
  const summary = summarize({
    range: '30d',
    since: null,
    until: NOW.toISOString(),
    rows,
    prices: PRICES,
  });
  assert.equal(summary.byJob.length, 100);
  assert.equal(summary.byJob[0].jobId, '130');
});

test('calls maps storage rows to the public shape with per-call price', async () => {
  const stored = {
    id: 12,
    calledAt: '2026-11-11T10:00:00.000Z',
    provider: 'claude',
    model: 'sonnet',
    function: 'cv',
    jobId: 7,
    runId: null,
    company: 'Acme',
    role: 'Engineer',
    inputTokens: 1000,
    cacheReadTokens: 2000,
    cacheWriteTokens: 0,
    outputTokens: 500,
    reasoningTokens: 100,
    reportedCostUsd: 0.5,
    usageMissing: false,
    durationMs: 1234,
    source: 'live',
  };
  const { service: svc, seen } = service([], {
    calls: [
      stored,
      { ...stored, id: 11, model: 'other', reportedCostUsd: null, durationMs: null },
      { ...stored, id: 10, reportedCostUsd: null },
    ],
    total: 250,
  });
  const result = await svc.calls({ range: '7d', jobId: '7', limit: 2 });
  validate('CostCallsResponse')(envelope(result));
  assert.equal(result.total, 250);
  assert.equal(result.calls[0].id, '12');
  assert.equal(result.calls[0].jobId, '7');
  assert.equal(result.calls[0].cachedInputTokens, 2000);
  assert.equal(result.calls[0].totalTokens, 3500);
  // A CLI-reported cost wins over the table price.
  assert.equal(result.calls[0].estimatedUsd, 0.5);
  assert.equal(result.calls[1].estimatedUsd, null);
  assert.equal(result.calls[2].estimatedUsd, 0.0111);
  assert.equal(result.calls[1].durationMs, null);
  assert.deepEqual(Object.keys(result.calls[0]).sort(), Object.keys(result.calls[1]).sort());
  assert.deepEqual(seen[0][1], {
    range: '7d',
    jobId: '7',
    limit: 2,
    estimates: 'include',
    now: NOW,
  });
  assert.equal(seen[1][1].jobId, '7');
});

test('query validation is strict', () => {
  const summary = { allowed: ['range', 'estimates'] };
  const calls = { allowed: ['range', 'jobId', 'limit', 'estimates'] };
  assert.deepEqual(normalizeCostQuery({}, summary), { range: '30d', estimates: 'include' });
  assert.deepEqual(normalizeCostQuery({ range: 'all', estimates: 'exclude' }, summary), {
    range: 'all',
    estimates: 'exclude',
  });
  assert.deepEqual(normalizeCostQuery({}, calls), {
    range: '30d',
    estimates: 'include',
    jobId: null,
    limit: 100,
  });
  assert.deepEqual(normalizeCostQuery({ jobId: '9', limit: '500' }, calls), {
    range: '30d',
    estimates: 'include',
    jobId: '9',
    limit: 500,
  });
  for (const bad of [
    [{ range: '1d' }, summary],
    [{ estimates: 'only' }, summary],
    [{ estimates: '' }, calls],
    [{ estimates: 'Include' }, calls],
    [{ estimates: 'exclude' }, { allowed: ['range'] }],
    [{ range: '' }, summary],
    [{ range: '30D' }, summary],
    [{ jobId: '1' }, summary],
    [{ jobId: '0' }, calls],
    [{ jobId: '01' }, calls],
    [{ jobId: '1; drop' }, calls],
    [{ limit: '0' }, calls],
    [{ limit: '501' }, calls],
    [{ limit: '1e2' }, calls],
    [{ limit: '-1' }, calls],
    [{ limit: '' }, calls],
  ]) {
    assert.throws(
      () => normalizeCostQuery(...bad),
      { publicCode: 'INVALID_REQUEST' },
      JSON.stringify(bad),
    );
  }
});

test('storage failures become the public database errors without driver text', async () => {
  const failing = error => ({
    cube: async () => {
      throw error;
    },
    calls: async () => [],
    count: async () => 0,
  });
  const make = error =>
    createCostService({ reader: failing(error), prices: () => ({ prices: [] }), now: () => NOW });
  await assert.rejects(
    make(Object.assign(new Error('relation llm_calls'), { code: '42P01' })).summary(),
    SchemaNotReadyError,
  );
  await assert.rejects(make(new Error('password=secret')).summary(), error => {
    assert.ok(error instanceof DatabaseUnavailableError);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('the default reader delegates to the storage functions', async () => {
  const calls = [];
  const record = name => async args => (calls.push([name, args]), name === 'countCalls' ? 3 : []);
  const reader = createCostReader({
    storage: {
      cubeCalls: record('cubeCalls'),
      readCalls: record('readCalls'),
      countCalls: record('countCalls'),
    },
  });
  await reader.cube({ range: '7d' });
  await reader.calls({ range: '7d', limit: 5 });
  assert.equal(await reader.count({ range: '7d' }), 3);
  assert.deepEqual(
    calls.map(c => c[0]),
    ['cubeCalls', 'readCalls', 'countCalls'],
  );
});

test('reported cost is used per call and the table prices only the unreported share', () => {
  const summarizeRows = rows =>
    summarize({ range: '30d', since: null, until: NOW.toISOString(), rows, prices: PRICES });
  // All calls reported: the reported sum, even for an unpriced model, and not listed as unpriced.
  const reported = summarizeRows([
    cube({
      model: 'mystery',
      calls: 2,
      reportedCostUsd: 1.25,
      reportedCostCalls: 2,
      unreported: { calls: 0 },
    }),
  ]);
  assert.equal(reported.totals.estimatedUsd, 1.25);
  assert.deepEqual(reported.unpriced, []);
  // One of two calls reported: the reported sum plus the table price of the unreported tokens.
  const rest = {
    calls: 1,
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    outputTokens: 100_000,
  };
  const mixed = summarizeRows([
    cube({ calls: 2, reportedCostUsd: 1, reportedCostCalls: 1, unreported: rest }),
  ]);
  assert.equal(mixed.totals.estimatedUsd, 9.55);
  // Unpriced model with only part reported: priced floor, model still listed.
  const partial = summarizeRows([
    cube({
      model: 'mystery',
      calls: 2,
      reportedCostUsd: 1,
      reportedCostCalls: 1,
      unreported: rest,
    }),
  ]);
  assert.equal(partial.totals.estimatedUsd, 1);
  assert.deepEqual(partial.unpriced, ['claude/mystery']);
  assert.equal(partial.totals.unpricedCalls, 1);
  assert.equal(reported.totals.unpricedCalls, 0);
  assert.equal(mixed.totals.unpricedCalls, 0);
});

test('the long-prompt tier applies when the average prompt per call is over the threshold', () => {
  const tiered = {
    ...price('claude', 'haiku', 0.1, 0.01, 0.125, 0.5),
    longContext: {
      promptTokensOver: 100_000,
      inputUsdPerMtok: 0.5,
      cachedInputUsdPerMtok: 0.05,
      cacheWriteUsdPerMtok: 0.625,
      outputUsdPerMtok: 2.5,
    },
  };
  const run = (prompt, calls) =>
    summarize({
      range: '30d',
      since: null,
      until: NOW.toISOString(),
      rows: [
        cube({
          model: 'haiku',
          calls,
          inputTokens: prompt,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
        }),
      ],
      prices: [tiered],
    });
  assert.equal(run(100_000, 1).totals.estimatedUsd, 0.01);
  assert.equal(run(100_001, 1).totals.estimatedUsd, 0.050001);
  assert.equal(run(300_000, 3).totals.estimatedUsd, 0.03);
  // The public prices list carries only the schema fields.
  assert.equal(Object.hasOwn(run(1, 1).prices[0], 'longContext'), false);
});

test('an invalid prices file is a public error, a missing one is not', async () => {
  const reader = {
    cube: async () => ({ since: null, rows: [] }),
    calls: async () => [],
    count: async () => 0,
  };
  const make = loaded => createCostService({ reader, prices: () => loaded, now: () => NOW });
  await assert.rejects(make({ prices: [], error: 'invalid', source: 'config' }).summary(), {
    publicCode: 'PRICES_UNREADABLE',
    statusCode: 503,
  });
  await assert.rejects(make({ prices: [], error: 'unreadable', source: 'config' }).calls(), {
    publicCode: 'PRICES_UNREADABLE',
  });
  assert.equal((await make({ prices: [], error: null, source: 'none' }).summary()).totals.calls, 0);
});

test('estimates: echoed, passed to the reader, counted per group and table priced', async () => {
  const seenArgs = [];
  const rows = [
    cube({
      calls: 3,
      estimatedCalls: 0,
      reportedCostUsd: 3,
      reportedCostCalls: 3,
      unreported: { calls: 0 },
    }),
    // Estimated rows have no reported cost: they take the unreported (table) path.
    cube({
      model: 'sonnet',
      function: 'cv',
      day: '2026-11-09',
      jobId: '8',
      calls: 2,
      estimatedCalls: 2,
    }),
  ];
  const reader = {
    cube: async args => (seenArgs.push(args), { since: null, rows }),
    calls: async () => [],
    count: async () => 0,
  };
  const svc = createCostService({ reader, prices: () => ({ prices: PRICES }), now: () => NOW });
  const summary = await svc.summary({ range: 'all', estimates: 'exclude' });
  assert.equal(seenArgs[0].estimates, 'exclude');
  assert.equal(summary.estimates, 'exclude');
  validate('CostSummaryResponse')(envelope(summary));
  assert.equal((await svc.summary({ range: 'all' })).estimates, 'include');
  assert.equal(summary.totals.estimatedCalls, 2);
  assert.equal(summary.byFunction.find(r => r.function === 'cv').estimatedCalls, 2);
  assert.equal(summary.byFunction.find(r => r.function === 'evaluation').estimatedCalls, 0);
  assert.equal(summary.byDay.find(d => d.day === '2026-11-09').estimatedCalls, 2);
  assert.equal(summary.byJob.find(j => j.jobId === '8').estimatedCalls, 2);
  assert.equal(summary.byModel[0].estimatedCalls, 2);
  // 3 reported + 8.55 table price of the estimated row.
  assert.equal(summary.totals.estimatedUsd, 11.55);
  // estimatedCalls never exceeds calls.
  const capped = summarize({
    range: 'all',
    since: null,
    until: NOW.toISOString(),
    rows: [cube({ calls: 1, estimatedCalls: 5 })],
    prices: PRICES,
  });
  assert.equal(capped.totals.estimatedCalls, 1);
  assert.equal(capped.estimates, 'include');
});

test('call rows pass source estimate through and do not leak estimatedCalls', async () => {
  const stored = {
    id: 5,
    calledAt: '2026-11-01T10:00:00.000Z',
    provider: 'claude',
    model: 'sonnet',
    function: 'cv',
    jobId: null,
    runId: null,
    inputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 100,
    reasoningTokens: 0,
    reportedCostUsd: null,
    durationMs: null,
    source: 'estimate',
  };
  const { service: svc } = service([], { calls: [stored] });
  const result = await svc.calls({ estimates: 'include' });
  validate('CostCallsResponse')(envelope(result));
  assert.equal(result.calls[0].source, 'estimate');
  assert.equal(result.calls[0].estimatedUsd, 0.0045);
  assert.equal('estimatedCalls' in result.calls[0], false);
});
