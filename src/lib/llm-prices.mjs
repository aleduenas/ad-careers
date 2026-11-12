// Public API prices for the Cost page. Reads the optional private config/llm-prices.json:
//   { "version": 1, "prices": [ { provider, model, inputUsdPerMtok, cachedInputUsdPerMtok,
//     cacheWriteUsdPerMtok, outputUsdPerMtok, source } ] }
// All prices are USD per million tokens. A model without an entry is unpriced: its cost is null,
// never zero. Token buckets are disjoint (see estimateUsd), so the estimate is a plain sum.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './root.mjs';

export const PRICES_FILE = join(root, 'config', 'llm-prices.json');
export const DEFAULT_PRICES_FILE = join(root, 'config', 'examples', 'llm-prices.example.json');
const PROVIDERS = new Set(['claude', 'codex']);
const PRICE_FIELDS = [
  'inputUsdPerMtok',
  'cachedInputUsdPerMtok',
  'cacheWriteUsdPerMtok',
  'outputUsdPerMtok',
];

export const priceKey = (provider, model) => `${provider}\u0000${model}`;

// Validates a parsed file and returns the price list; throws a plain Error naming the first
// problem (field path only, never file contents).
export function validatePrices(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1)
    throw new Error('llm-prices: version must be 1');
  if (!Array.isArray(value.prices)) throw new Error('llm-prices: prices must be an array');
  const seen = new Set();
  return value.prices.map((entry, index) => {
    const at = `llm-prices: prices[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error(`${at} must be an object`);
    if (!PROVIDERS.has(entry.provider)) throw new Error(`${at}.provider must be claude or codex`);
    if (typeof entry.model !== 'string' || !entry.model.trim() || entry.model.length > 120)
      throw new Error(`${at}.model must be a non-empty string`);
    for (const field of PRICE_FIELDS)
      if (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]) || entry[field] < 0)
        throw new Error(`${at}.${field} must be a number of at least 0`);
    if (typeof entry.source !== 'string' || !entry.source.trim())
      throw new Error(`${at}.source must name the pricing page and fetch date`);
    let longContext;
    if (entry.longContext !== undefined) {
      const tier = entry.longContext;
      if (!tier || typeof tier !== 'object' || Array.isArray(tier))
        throw new Error(`${at}.longContext must be an object`);
      if (!Number.isInteger(tier.promptTokensOver) || tier.promptTokensOver < 1)
        throw new Error(`${at}.longContext.promptTokensOver must be a positive integer`);
      for (const field of PRICE_FIELDS)
        if (typeof tier[field] !== 'number' || !Number.isFinite(tier[field]) || tier[field] < 0)
          throw new Error(`${at}.longContext.${field} must be a number of at least 0`);
      longContext = { promptTokensOver: tier.promptTokensOver };
      for (const field of PRICE_FIELDS) longContext[field] = tier[field];
    }
    const key = priceKey(entry.provider, entry.model);
    if (seen.has(key)) throw new Error(`${at} duplicates ${entry.provider}/${entry.model}`);
    seen.add(key);
    return {
      provider: entry.provider,
      model: entry.model,
      inputUsdPerMtok: entry.inputUsdPerMtok,
      cachedInputUsdPerMtok: entry.cachedInputUsdPerMtok,
      cacheWriteUsdPerMtok: entry.cacheWriteUsdPerMtok,
      outputUsdPerMtok: entry.outputUsdPerMtok,
      source: entry.source,
      ...(longContext ? { longContext } : {}),
    };
  });
}

// config/llm-prices.json, when present, replaces the shipped defaults entirely. When it is absent
// the shipped config/examples/llm-prices.example.json is used (source 'default'). A config file that
// exists but cannot be read or fails validation is an error ('unreadable' or 'invalid') with no
// prices: it is never silently replaced by the defaults.
export function loadPrices({
  file = PRICES_FILE,
  defaultFile = DEFAULT_PRICES_FILE,
  readText = path => readFileSync(path, 'utf8'),
} = {}) {
  const read = (path, source) => {
    let text;
    try {
      text = readText(path);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      return { prices: [], error: 'unreadable', source };
    }
    try {
      return {
        prices: validatePrices(JSON.parse(text.replace(/^﻿/, ''))),
        error: null,
        source,
      };
    } catch {
      return { prices: [], error: 'invalid', source };
    }
  };
  return (
    read(file, 'config') ??
    read(defaultFile, 'default') ?? { prices: [], error: null, source: 'none' }
  );
}

export function priceIndex(prices) {
  return new Map(prices.map(price => [priceKey(price.provider, price.model), price]));
}

// Exact provider/model id, else the id after removing one trailing "-YYYYMMDD" date suffix (so
// "claude-haiku-4-5-20251001" finds "claude-haiku-4-5"). Nothing else: a future "claude-sonnet-5-6"
// never takes the "claude-sonnet-5" price.
export function findPrice(index, provider, model) {
  const id = String(model);
  const exact = index.get(priceKey(provider, id));
  if (exact) return exact;
  const base = id.replace(/-[0-9]{8}$/, '');
  return base === id ? undefined : index.get(priceKey(provider, base));
}

// tokens: { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens }. The buckets are
// disjoint: input is uncached input only, cached is cache reads, cache write is cache creation,
// and output already includes reasoning/thinking tokens (both providers bill those as output), so
// reasoningTokens is display-only and is never added again. Returns null for an unpriced model.
export function estimateUsd(tokens, price, calls = 1) {
  if (!price) return null;
  // Optional long-prompt tier (Haiku 5.5): chosen by the prompt length of one call (input + cache
  // reads + cache writes). For a group of calls the average prompt per call decides.
  const prompt = tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens;
  const rate =
    price.longContext && prompt / Math.max(1, calls) > price.longContext.promptTokensOver
      ? price.longContext
      : price;
  const usd =
    (tokens.inputTokens * rate.inputUsdPerMtok +
      tokens.cachedInputTokens * rate.cachedInputUsdPerMtok +
      tokens.cacheWriteTokens * rate.cacheWriteUsdPerMtok +
      tokens.outputTokens * rate.outputUsdPerMtok) /
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}
