#!/usr/bin/env node

/** Bounded portal coverage and reachability audit. Never writes user data. */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

import { makeHttpCtx } from '../scan/providers/_http.mjs';
import { loadProviders, resolveProvider } from '../scan/scan.mjs';
import { root } from '../lib/root.mjs';

const REQUEST_BUDGET = 4;

class ProbeBudgetReached extends Error {}

function boundedContext(base) {
  let used = 0;
  let tripped = false;
  const guard =
    fn =>
    async (...args) => {
      if (used >= REQUEST_BUDGET) {
        tripped = true;
        throw new ProbeBudgetReached('probe request budget reached');
      }
      used++;
      return fn(...args);
    };
  return {
    ctx: {
      ...base,
      probe: true,
      dryRun: true,
      shouldFetchContent: () => false,
      get: guard(base.get.bind(base)),
      getJson: guard(base.getJson.bind(base)),
      postJson: guard(base.postJson.bind(base)),
    },
    wasTripped: () => tripped,
  };
}

export function classifyPortal(entry, providers) {
  if (entry.scan_class === 'retired') return { classification: 'retired', resolved: null };
  const resolved = resolveProvider(entry, providers);
  if (resolved?.provider) return { classification: 'structured', resolved };
  if (resolved?.error) return { classification: 'structured', resolved };
  if (entry.scan_class === 'rich-only' || ['websearch', 'rich'].includes(entry.scan_method)) {
    return { classification: 'rich-only', resolved: null };
  }
  return { classification: 'unclassified', resolved: null };
}

export async function verifyPortalEntries(
  entries,
  { providers, httpCtx = makeHttpCtx(), includeDisabled = false, companyFilter = null } = {},
) {
  const results = [];
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (!includeDisabled && entry.enabled === false) continue;
    if (
      companyFilter &&
      !String(entry.name || '')
        .toLowerCase()
        .includes(companyFilter.toLowerCase())
    )
      continue;
    const enabled = entry.enabled !== false;
    const classified = classifyPortal(entry, providers);
    const base = {
      company: entry.name || '(unnamed)',
      enabled,
      classification: classified.classification,
      provider: classified.resolved?.provider?.id || entry.provider || null,
      careers_url: entry.careers_url || null,
      status: null,
      jobs_found: 0,
      reason: null,
    };

    if (classified.classification === 'retired') {
      results.push({
        ...base,
        status: 'retired',
        reason: entry.retired_reason || entry.notes || 'retired',
      });
      continue;
    }
    if (classified.classification === 'unclassified') {
      results.push({
        ...base,
        status: 'unclassified',
        reason: 'no provider and no rich-only classification',
      });
      continue;
    }
    if (classified.classification === 'rich-only') {
      if (!entry.careers_url) {
        results.push({
          ...base,
          status: 'rich-only',
          reason: 'missing careers_url',
          reachability: 'error',
        });
        continue;
      }
      try {
        await httpCtx.get(entry.careers_url);
        results.push({ ...base, status: 'rich-only', reachability: 'ok' });
      } catch (error) {
        results.push({
          ...base,
          status: 'rich-only',
          reachability: 'blocked-or-error',
          reason: error.message,
        });
      }
      continue;
    }
    if (classified.resolved?.error) {
      results.push({ ...base, status: 'error', reason: classified.resolved.error });
      continue;
    }

    const bounded = boundedContext(httpCtx);
    try {
      const jobs = await classified.resolved.provider.fetch(entry, bounded.ctx);
      if (!Array.isArray(jobs)) throw new Error('provider did not return an array');
      results.push({
        ...base,
        status: jobs.length ? 'ok' : 'empty',
        jobs_found: jobs.length,
        partial: bounded.wasTripped(),
      });
    } catch (error) {
      if (error instanceof ProbeBudgetReached || bounded.wasTripped()) {
        results.push({
          ...base,
          status: 'ok',
          partial: true,
          reason: 'bounded probe reached request limit',
        });
      } else {
        results.push({ ...base, status: 'error', reason: error.message });
      }
    }
  }
  return results;
}

function printRows(results) {
  const icons = {
    ok: '✓',
    empty: '○',
    error: '✗',
    'rich-only': '→',
    retired: '—',
    unclassified: '!',
  };
  for (const row of results) {
    const source = row.provider || row.classification;
    let detail = `${source}; ${row.status}`;
    if (row.jobs_found) detail += `; ${row.jobs_found} jobs`;
    if (row.reachability) detail += `; reachability ${row.reachability}`;
    if (row.partial) detail += '; bounded/partial';
    if (row.reason) detail += `; ${row.reason}`;
    console.log(` ${icons[row.status] || '?'} ${row.company} — ${detail}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const includeDisabled = args.includes('--include-disabled');
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const companyIndex = args.indexOf('--company');
  const companyEquals = args.find(arg => arg.startsWith('--company='))?.slice('--company='.length);
  const companyFilter = (companyIndex >= 0 ? args[companyIndex + 1] : companyEquals) || null;
  if (!existsSync(path.join(root, 'config/portals.yml'))) {
    console.error('Error: config/portals.yml not found. Run onboarding first.');
    process.exit(1);
  }
  const config = yaml.load(readFileSync(path.join(root, 'config/portals.yml'), 'utf-8'));
  const providers = await loadProviders();
  const results = await verifyPortalEntries(config.tracked_companies || [], {
    providers,
    includeDisabled,
    companyFilter,
  });
  const summary = {
    total: results.length,
    structured_ok: results.filter(
      row => row.classification === 'structured' && ['ok', 'empty'].includes(row.status),
    ).length,
    structured_error: results.filter(
      row => row.classification === 'structured' && row.status === 'error',
    ).length,
    rich_only: results.filter(row => row.classification === 'rich-only').length,
    retired: results.filter(row => row.classification === 'retired').length,
    unclassified: results.filter(row => row.classification === 'unclassified').length,
  };
  if (json)
    console.log(
      JSON.stringify(
        { schema_version: 1, generated_at: new Date().toISOString(), summary, portals: results },
        null,
        2,
      ),
    );
  else {
    console.log(
      `Portal audit — ${includeDisabled ? 'all configured entries' : 'enabled entries'}\n`,
    );
    printRows(results);
    console.log(
      `\n${summary.total} audited: ${summary.structured_ok} structured healthy, ${summary.structured_error} structured errors, ${summary.rich_only} rich-only, ${summary.retired} retired, ${summary.unclassified} unclassified`,
    );
  }
  const strictFailures = results.filter(
    row =>
      row.enabled &&
      ((row.classification === 'structured' && row.status === 'error') ||
        row.classification === 'unclassified'),
  );
  if (strict && strictFailures.length) process.exit(1);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Portal verification failed: ${error.message}`);
    process.exit(1);
  });
}
