#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner with a plugin-based provider layer.
 *
 * Providers live in providers/*.mjs and are loaded at startup. Each provider
 * exports a default object with:
 *   - id: string — matched against `provider:` in portals.yml
 *   - detect(entry): {url}|null — optional auto-detection from careers_url
 *   - fetch(entry, ctx): [{title,url,company,location}] — required
 *
 * Files prefixed with _ are shared helpers (e.g. _http.mjs) and are never
 * loaded as providers. Adding a new source = drop a *.mjs into providers/,
 * no scan.mjs edits.
 *
 * A tracked_companies entry can set `provider:` explicitly to bypass
 * URL-based auto-detection. The `transport:` field is reserved for future
 * transports — Phase A only ships the http transport.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 *   node scan.mjs --report-json logs/scan/coverage.json
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';

import { makeHttpCtx, htmlToText } from './providers/_http.mjs';
import { gate } from './location-gate-core.mjs';
import { query, createJob, urlKey } from '../lib/_database.mjs';

const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'config/portals.yml';
const PROVIDERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'providers');
const JDS_DIR = 'data/jds';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;

// ── JD caching ──────────────────────────────────────────────────────

export function slugify(str) {
  return (str || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function saveJd(company, title, url, content, source, date, location = '') {
  if (!content) return;
  const companySlug = slugify(company);
  const roleSlug = slugify(title);
  const dir = path.join(JDS_DIR, companySlug);
  const filePath = jdStoragePath(company, title, url);
  if (existsSync(filePath)) return;
  mkdirSync(dir, { recursive: true });
  // Pre-formatted content (e.g. hiring-cafe provider already builds frontmatter) — write as-is
  if (content.trimStart().startsWith('---')) {
    writeFileSync(filePath, content, 'utf-8');
    return;
  }
  // htmlToText is safe on plain text too (its patterns only match HTML), so this
  // catches providers whose upstream API returns already-entity-encoded HTML
  // (literal "&lt;div&gt;" instead of a real tag) as well as normal raw HTML.
  const body = htmlToText(content).trim();
  writeFileSync(
    filePath,
    `---\ncompany: ${company}\nrole: ${title}\nurl: ${url}\nsource: ${source}\nlocation: ${location}\nfetched: ${date}\n---\n\n${body}\n`,
    'utf-8',
  );
}

export function jdStoragePath(company, title, url) {
  const base = path.join(JDS_DIR, slugify(company), slugify(title) + '.md');
  if (!existsSync(base)) return base;
  const contents = readFileSync(base, 'utf8');
  const existing = contents.match(/^url:\s*(.+)$/m)?.[1]?.trim();
  // A tagged JD is already owned by a permanent job ID. Even when another
  // posting has the same role title and verbatim description, never reuse that
  // file: withJobID() must be able to attach the new posting independently.
  if (/<!-- career-ops-job-id: \d+ -->/.test(contents)) {
    return (
      base.slice(0, -3) +
      '-' +
      createHash('sha256')
        .update(urlKey(url) || url)
        .digest('hex')
        .slice(0, 16) +
      '.md'
    );
  }
  if (!existing || urlKey(existing) === urlKey(url)) return base;
  return (
    base.slice(0, -3) +
    '-' +
    createHash('sha256')
      .update(urlKey(url) || url)
      .digest('hex')
      .slice(0, 16) +
    '.md'
  );
}

// ── Provider loading ────────────────────────────────────────────────

export async function loadProviders(dir = PROVIDERS_DIR) {
  const providers = new Map();
  if (!existsSync(dir)) return providers;
  // Alphabetical order so detect() priority is deterministic across machines.
  const entries = readdirSync(dir)
    .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();
  for (const file of entries) {
    const full = path.join(dir, file);
    let mod;
    try {
      mod = await import(pathToFileURL(full).href);
    } catch (err) {
      console.error(`⚠️  ${file}: failed to load — ${err.message}`);
      continue;
    }
    const p = mod.default;
    if (!p || typeof p.fetch !== 'function' || !p.id) {
      console.error(`⚠️  ${file}: skipping — default export must be { id, fetch }`);
      continue;
    }
    if (providers.has(p.id)) {
      console.error(`⚠️  ${file}: duplicate provider id "${p.id}" — keeping first`);
      continue;
    }
    providers.set(p.id, p);
  }
  return providers;
}

// Resolve which provider handles a tracked_companies entry.
// 1. Explicit `provider:` field wins (skips detect()).
// 2. Otherwise each provider's detect() runs in load order; first hit wins.
export function resolveProvider(entry, providers) {
  if (entry.provider) {
    const p = providers.get(entry.provider);
    if (!p) return { error: `unknown provider: ${entry.provider}` };
    return { provider: p };
  }
  for (const p of providers.values()) {
    let hit;
    try {
      hit = p.detect?.(entry);
    } catch (err) {
      console.error(`⚠️  ${p.id}: detect() threw for "${entry.name}" — ${err.message}`);
      continue;
    }
    if (hit) return { provider: p };
  }
  return null;
}

// ── Title filter ────────────────────────────────────────────────────

export function buildTitleFilter(titleFilter, additionalPositive = []) {
  const positive = [...(titleFilter?.positive || []), ...additionalPositive].map(k =>
    k.toLowerCase(),
  );
  const negative = (titleFilter?.negative || []).map(buildNegativeMatcher);

  return title => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(matcher => matcher(lower));
    return hasPositive && !hasNegative;
  };
}

// Word-boundary matching for alphanumeric keywords (e.g. "Lead") so a bare
// substring check doesn't miss punctuation-adjacent hits like "Lead," or
// "Lead:" — the previous "Lead "/" Lead" padding trick required an exact
// space and let titles like "Lead, Data Development" slip through.
// Keywords containing punctuation (".NET", "No-Code") keep plain substring
// matching since word-boundary semantics don't apply cleanly to them.
function buildNegativeMatcher(keyword) {
  const trimmed = keyword.trim().toLowerCase();
  if (/^[a-z0-9 ]+$/.test(trimmed)) {
    const re = new RegExp(`(?<![a-z0-9])${trimmed}(?![a-z0-9])`, 'i');
    return lower => re.test(lower);
  }
  return lower => lower.includes(trimmed);
}

// ── Location filter ─────────────────────────────────────────────────
// Optional. If `location_filter` is absent from portals.yml, all locations pass.
// Semantics:
//   - Empty location string → pass (don't penalize missing data)
//   - `block` matches → reject (takes precedence over allow)
//   - `allow` empty → pass (already cleared block)
//   - `allow` non-empty → must match at least one keyword
// All matches are case-insensitive substring.

export function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const allow = (locationFilter.allow || []).map(k => k.toLowerCase());
  const block = (locationFilter.block || []).map(k => k.toLowerCase());

  return location => {
    if (!location) return true;
    const lower = location.toLowerCase();
    if (block.length > 0 && block.some(k => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

export async function loadSeenUrls() {
  const rows = await query(
    'SELECT url FROM jobs WHERE url IS NOT NULL UNION SELECT url FROM scan_history',
  );
  const seen = new Set(rows.map(r => r.url)),
    keys = new Set(rows.map(r => urlKey(r.url)));
  seen.has = url => keys.has(urlKey(url));
  seen.add = url => {
    keys.add(urlKey(url));
    Set.prototype.add.call(seen, url);
    return seen;
  };
  return seen;
}
export async function loadSeenCompanyRoles() {
  return new Set(
    (
      await query(
        "SELECT company,role FROM jobs UNION SELECT company,title AS role FROM scan_history WHERE status='added'",
      )
    ).map(r => r.company.toLowerCase() + '::' + r.role.toLowerCase()),
  );
}
export async function appendToPipeline(offers, sourceDate) {
  const jobs = [];
  for (const o of offers)
    jobs.push(
      await createJob({
        company: o.company,
        role: o.title,
        url: o.url,
        jd_path: jdStoragePath(o.company, o.title, o.url),
        source_date: sourceDate,
      }),
    );
  return jobs;
}
export async function appendToScanHistory(offers, date, statusOverride = 'added') {
  for (const o of offers)
    await query(
      'INSERT INTO scan_history(url,first_seen,portal,title,company,status,location) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        o.url,
        date,
        o.source || '',
        o.title || '',
        o.company || '',
        statusOverride,
        o.location || '',
      ],
    );
}

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const companyEquals = args.find(arg => arg.startsWith('--company='))?.slice('--company='.length);
  const filterCompany =
    (companyFlag !== -1 ? args[companyFlag + 1] : companyEquals)?.toLowerCase() || null;
  const reportFlag = args.indexOf('--report-json');
  const reportEquals = args
    .find(arg => arg.startsWith('--report-json='))
    ?.slice('--report-json='.length);
  const reportPath = reportFlag !== -1 ? args[reportFlag + 1] : reportEquals;

  // 1. Load providers
  const providers = await loadProviders(PROVIDERS_DIR);
  if (providers.size === 0) {
    console.error('Error: no providers loaded from providers/');
    process.exit(1);
  }

  // 2. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);

  // 3. Resolve a provider for each enabled company
  const targets = [];
  const coverage = [];
  const richOnly = [];
  const unclassified = [];
  const resolveErrors = [];
  for (const company of companies) {
    if (company.enabled === false) continue;
    if (typeof company.name !== 'string' || !company.name) {
      console.error(
        `⚠️  Skipping entry — missing or non-string 'name' field: ${JSON.stringify(company)}`,
      );
      continue;
    }
    if (filterCompany && !company.name.toLowerCase().includes(filterCompany)) continue;
    const resolved = resolveProvider(company, providers);
    if (!resolved) {
      const declaredRich =
        company.scan_class === 'rich-only' || ['websearch', 'rich'].includes(company.scan_method);
      const row = {
        company: company.name,
        classification: declaredRich ? 'rich-only' : 'unclassified',
        provider: null,
        status: declaredRich ? 'rich-only' : 'error',
        jobs_found: 0,
        reason: declaredRich
          ? 'requires browser/search discovery'
          : 'no provider matched and no rich-only classification',
        careers_url: company.careers_url || null,
        scan_query: company.scan_query || null,
      };
      coverage.push(row);
      (declaredRich ? richOnly : unclassified).push(row);
      continue;
    }
    if (resolved.error) {
      const row = {
        company: company.name,
        classification: 'structured',
        provider: company.provider || null,
        status: 'error',
        jobs_found: 0,
        reason: resolved.error,
        careers_url: company.careers_url || null,
        scan_query: company.scan_query || null,
      };
      coverage.push(row);
      resolveErrors.push({ company: company.name, error: resolved.error });
      continue;
    }
    const row = {
      company: company.name,
      classification: 'structured',
      provider: resolved.provider.id,
      status: 'pending',
      jobs_found: 0,
      reason: null,
      careers_url: company.careers_url || null,
      scan_query: company.scan_query || null,
    };
    coverage.push(row);
    targets.push({ ...company, _provider: resolved.provider, _coverage: row });
  }

  console.log(
    `Scanning ${targets.length} companies via providers (${richOnly.length} rich-only, ${unclassified.length} unclassified)`,
  );
  if (dryRun) {
    console.log(
      reportPath
        ? '(dry run — user data will not change; only the requested coverage report will be written)\n'
        : '(dry run — no files will be written)\n',
    );
  }

  // 4. Load dedup sets
  const seenUrls = await loadSeenUrls();
  const seenCompanyRoles = await loadSeenCompanyRoles();

  // 5. Fetch from each target
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredLocation = 0;
  let totalDupes = 0;
  let totalGateFailed = 0;
  let totalMissingContent = 0;
  const newOffers = [];
  const errors = [...resolveErrors];

  const tasks = targets.map(company => async () => {
    const provider = company._provider;
    // Company-specific discovery terms retain the global seniority exclusions.
    const companyTitleFilter = company.title_filter_positive?.length
      ? buildTitleFilter(config.title_filter, company.title_filter_positive)
      : titleFilter;
    const ctx = makeHttpCtx();
    ctx.dryRun = dryRun;
    ctx.shouldFetchContent = job => {
      if (!companyTitleFilter(job.title) || !locationFilter(job.location)) return false;
      if (seenUrls.has(job.url)) return false;
      const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
      return !seenCompanyRoles.has(key);
    };
    try {
      const jobs = await provider.fetch(company, ctx);
      if (!Array.isArray(jobs)) {
        throw new Error(`${provider.id}: fetch() did not return an array`);
      }
      company._coverage.jobs_found = jobs.length;
      company._coverage.status = jobs.length > 0 ? 'ok' : 'empty';
      totalFound += jobs.length;

      for (const job of jobs) {
        const source = `${provider.id}-api`;
        if (!companyTitleFilter(job.title)) {
          totalFilteredTitle++;
          seenUrls.add(job.url);
          if (!dryRun) await appendToScanHistory([{ ...job, source }], date, 'skipped_title');
          continue;
        }
        if (!locationFilter(job.location)) {
          totalFilteredLocation++;
          seenUrls.add(job.url);
          if (!dryRun) await appendToScanHistory([{ ...job, source }], date, 'skipped_location');
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        const substantiveContent = htmlToText(job.content || '').trim();
        if (substantiveContent.length < 300) {
          totalMissingContent++;
          continue;
        }
        job.content = substantiveContent;
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        // Cache JD before gate so the gate can read the full text
        if (!dryRun)
          saveJd(job.company, job.title, job.url, job.content, source, date, job.location || '');

        // Location gate — read back the file we just wrote (or use inline content)
        const jdText = job.content || null;
        const gateResult = gate(job.url, job.company, job.title, jdText, job.location || '');
        if (gateResult.decision === 'FAIL') {
          totalGateFailed++;
          // Write to scan-history with location-fail so it won't resurface next scan
          if (!dryRun)
            await appendToScanHistory(
              [{ ...job, source, location: job.location || '' }],
              date,
              'location-fail',
            );
          continue;
        }

        newOffers.push({ ...job, source });
      }
    } catch (err) {
      company._coverage.status = 'error';
      company._coverage.reason = err.message;
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 6. Write results
  if (!dryRun && newOffers.length > 0) {
    await appendToPipeline(newOffers, date);
    await appendToScanHistory(newOffers, date);
  }

  // 7. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFilteredTitle} removed`);
  console.log(`Filtered by location:  ${totalFilteredLocation} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`Location gate failed:  ${totalGateFailed} blocked`);
  console.log(`Missing full JD:       ${totalMissingContent} deferred`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (richOnly.length > 0) {
    console.log(`\nRich-scan handoff (${richOnly.length}):`);
    for (const row of richOnly)
      console.log(`  → ${row.company}: ${row.careers_url || 'no careers URL'}`);
  }

  if (unclassified.length > 0) {
    console.log(`\nUnclassified portals (${unclassified.length}):`);
    for (const row of unclassified)
      console.log(`  ! ${row.company}: add a provider or scan_class: rich-only`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to PostgreSQL`);
    }
  }

  if (reportPath) {
    const absolute = path.resolve(reportPath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      dry_run: dryRun,
      company_filter: filterCompany,
      summary: {
        structured: targets.length,
        rich_only: richOnly.length,
        unclassified: unclassified.length,
        ok: coverage.filter(row => row.status === 'ok').length,
        empty: coverage.filter(row => row.status === 'empty').length,
        error: coverage.filter(row => row.status === 'error').length,
        jobs_found: totalFound,
        new_offers: newOffers.length,
      },
      companies: coverage,
      search_queries: (config.search_queries || []).filter(query => query.enabled !== false),
    };
    writeFileSync(absolute, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    console.log(`\nCoverage report: ${reportPath}`);
  }

  console.log(`\n→ Run node src/eval/evaluate-jobs.mjs --next=5 to evaluate new offers.`);
  if (richOnly.length || errors.length)
    console.log('→ Run the dashboard pasted-JD action to cover browser/search gaps.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
