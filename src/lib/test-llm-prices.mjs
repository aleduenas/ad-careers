import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateUsd,
  findPrice,
  loadPrices,
  priceIndex,
  priceKey,
  validatePrices,
} from './llm-prices.mjs';

const entry = {
  provider: 'claude',
  model: 'm1',
  inputUsdPerMtok: 3,
  cachedInputUsdPerMtok: 0.3,
  cacheWriteUsdPerMtok: 3.75,
  outputUsdPerMtok: 15,
  source: 'https://example.invalid/pricing, fetched 2026-01-01',
};
const file = prices => JSON.stringify({ version: 1, prices });

test('estimateUsd sums disjoint buckets and never double counts reasoning', () => {
  const usd = estimateUsd(
    {
      inputTokens: 1_000_000,
      cachedInputTokens: 2_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 100_000,
      reasoningTokens: 80_000,
    },
    entry,
  );
  assert.equal(usd, 3 + 0.6 + 3.75 + 1.5);
});

test('estimateUsd is null, not zero, for an unpriced model and 0 for no tokens', () => {
  const zero = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  assert.equal(estimateUsd(zero, undefined), null);
  assert.equal(estimateUsd(zero, entry), 0);
});

test('loadPrices: missing file is empty and quiet, bad file is empty with an error code', () => {
  const missing = () => {
    throw Object.assign(new Error('x'), { code: 'ENOENT' });
  };
  assert.deepEqual(loadPrices({ readText: missing }), { prices: [], error: null, source: 'none' });
  assert.deepEqual(loadPrices({ readText: () => '{' }), {
    prices: [],
    error: 'invalid',
    source: 'config',
  });
  assert.deepEqual(loadPrices({ readText: () => file([{ ...entry, outputUsdPerMtok: -1 }]) }), {
    prices: [],
    error: 'invalid',
    source: 'config',
  });
  const denied = () => {
    throw Object.assign(new Error('secret path'), { code: 'EACCES' });
  };
  assert.deepEqual(loadPrices({ readText: denied }), {
    prices: [],
    error: 'unreadable',
    source: 'config',
  });
});

test('loadPrices accepts a BOM and drops unknown extra fields', () => {
  const result = loadPrices({ readText: () => '﻿' + file([{ ...entry, extra: 1 }]) });
  assert.equal(result.error, null);
  assert.deepEqual(result.prices, [entry]);
  assert.ok(priceIndex(result.prices).has(priceKey('claude', 'm1')));
});

test('validatePrices rejects duplicates, unknown providers and missing sources', () => {
  assert.throws(() => validatePrices({ version: 1, prices: [entry, entry] }), /duplicates/);
  assert.throws(
    () => validatePrices({ version: 1, prices: [{ ...entry, provider: 'other' }] }),
    /provider/,
  );
  assert.throws(() => validatePrices({ version: 1, prices: [{ ...entry, source: '' }] }), /source/);
  assert.throws(() => validatePrices({ version: 2, prices: [] }), /version/);
});

test('findPrice: exact id, else exact after one trailing date suffix, nothing looser', () => {
  const longer = { ...entry, model: 'm1-pro' };
  const index = priceIndex([entry, longer]);
  assert.equal(findPrice(index, 'claude', 'm1'), entry);
  assert.equal(findPrice(index, 'claude', 'm1-20261001'), entry);
  assert.equal(findPrice(index, 'claude', 'm1-pro'), longer);
  assert.equal(findPrice(index, 'claude', 'm1-pro-20261001'), longer);
  for (const id of [
    'm1[1m]',
    'm10',
    'm1x',
    'xm1',
    'm2',
    'M1',
    '',
    'm1-2',
    'm1-pro-x',
    'm1-20261001-1',
    'm1-2026100',
  ])
    assert.equal(findPrice(index, 'claude', id), undefined, id);
  assert.equal(findPrice(index, 'codex', 'm1-20261001'), undefined);
});

test('loadPrices: shipped defaults only when the config file is absent', () => {
  const files = {};
  const readText = path => {
    if (!(path in files)) throw Object.assign(new Error('x'), { code: 'ENOENT' });
    return files[path];
  };
  files['/defaults.json'] = file([entry]);
  const defaults = loadPrices({ file: '/config.json', defaultFile: '/defaults.json', readText });
  assert.equal(defaults.source, 'default');
  assert.deepEqual(defaults.prices, [entry]);
  // A present config replaces the defaults entirely.
  files['/config.json'] = file([{ ...entry, model: 'other' }]);
  const config = loadPrices({ file: '/config.json', defaultFile: '/defaults.json', readText });
  assert.equal(config.source, 'config');
  assert.deepEqual(
    config.prices.map(p => p.model),
    ['other'],
  );
  // A broken config is an error, never replaced by the defaults.
  files['/config.json'] = '{';
  assert.deepEqual(loadPrices({ file: '/config.json', defaultFile: '/defaults.json', readText }), {
    prices: [],
    error: 'invalid',
    source: 'config',
  });
});

test('the shipped example file loads and prices every listed Claude and Codex model id', () => {
  const loaded = loadPrices({ file: '/missing/config.json' });
  assert.equal(loaded.error, null);
  assert.equal(loaded.source, 'default');
  const index = priceIndex(loaded.prices);
  for (const id of [
    'sonnet',
    'opus',
    'haiku',
    'claude-sonnet-5',
    'claude-sonnet-5-5-20261001',
    'claude-haiku-4-5-20251001',
  ])
    assert.ok(findPrice(index, 'claude', id), id);
  assert.equal(findPrice(index, 'claude', 'claude-sonnet-5-5').inputUsdPerMtok, 2);
  assert.equal(findPrice(index, 'claude', 'claude-haiku-4-5-20251001').inputUsdPerMtok, 1);
  assert.equal(findPrice(index, 'claude', 'unknown'), undefined);
  // A future version never silently takes an older version's price.
  assert.equal(findPrice(index, 'claude', 'claude-sonnet-5-6'), undefined);
  // Claude entries use the 1-hour cache write price (2x input) the CLI writes.
  for (const p of loaded.prices.filter(p => p.provider === 'claude')) {
    assert.equal(p.cacheWriteUsdPerMtok, p.inputUsdPerMtok * 2, p.model);
    if (p.longContext)
      assert.equal(p.longContext.cacheWriteUsdPerMtok, p.longContext.inputUsdPerMtok * 2);
  }
  for (const id of ['gpt-6.1-sol', 'gpt-6-luna']) assert.ok(findPrice(index, 'codex', id), id);
});

test('longContext tier is validated and selected by prompt length per call', () => {
  const tier = {
    promptTokensOver: 100,
    inputUsdPerMtok: 10,
    cachedInputUsdPerMtok: 1,
    cacheWriteUsdPerMtok: 12,
    outputUsdPerMtok: 50,
  };
  const [parsed] = validatePrices({ version: 1, prices: [{ ...entry, longContext: tier }] });
  assert.deepEqual(parsed.longContext, tier);
  assert.throws(
    () =>
      validatePrices({
        version: 1,
        prices: [{ ...entry, longContext: { ...tier, promptTokensOver: 0 } }],
      }),
    /promptTokensOver/,
  );
  const none = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const call = { ...none, inputTokens: 100 };
  assert.equal(estimateUsd(call, parsed), 0.0003);
  assert.equal(estimateUsd({ ...call, inputTokens: 101 }, parsed), 0.00101);
  assert.equal(estimateUsd({ ...call, inputTokens: 200 }, parsed, 2), 0.0006);
});
