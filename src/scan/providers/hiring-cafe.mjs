/**
 * hiring-cafe.mjs — role-based discovery with canonical full-JD retrieval.
 *
 * hiring.cafe is used only for search discovery. Full descriptions come from
 * the search hit itself or from the employer's public ATS/careers URL. The
 * protected hiring.cafe /job detail endpoint is never requested.
 *
 * portals.yml entry:
 *   - name: hiring.cafe
 *     provider: hiring-cafe
 *     search_roles:
 *       - "machine learning engineer"
 *       - "data engineer"
 *     enabled: true
 *
 * Returns pre-formatted markdown so saveJd() does not add frontmatter twice.
 * The canonical URL is apply_url (the employer/ATS link), not hiring.cafe.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  fetchCanonicalJobDescription,
  fetchRenderedCanonicalJobDescription,
  mapWithHostLimits,
} from './_canonical-jd.mjs';

const BASE = 'https://hiringcafe.com';
const CACHE_PATH = 'data/hiring-cafe-search-cache.json';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function roleSlug(role) {
  return role
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadCache(cachePath) {
  if (!existsSync(cachePath)) return { version: 1, roles: {} };
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return parsed?.version === 1 && parsed?.roles ? parsed : { version: 1, roles: {} };
  } catch {
    return { version: 1, roles: {} };
  }
}

function cachedHits(cache, role, maxAgeMs) {
  const item = cache.roles[role];
  if (!item?.fetchedAt || !Array.isArray(item.hits)) return null;
  const age = Date.now() - Date.parse(item.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs ? item.hits : null;
}

function saveCache(cache, cachePath) {
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isCanadaEligible(v5) {
  const countries = v5?.workplace_countries || [];
  const type = (v5?.workplace_type || '').toUpperCase();
  const loc = (v5?.formatted_workplace_location || '').toLowerCase();

  if (countries.includes('CA')) return true;
  if (loc.includes('toronto') || loc.includes('ontario') || loc.includes('canada')) return true;
  if (countries.includes('US') && (type === 'REMOTE' || loc.includes('remote'))) return true;
  const continents = v5?.workplace_continents || [];
  if (continents.includes('NA') && type === 'REMOTE') return true;
  if (v5?.is_workplace_worldwide_ok) return true;
  return false;
}

function buildContent(hit, today, fullJdText, jdMethod) {
  const v5 = hit.v5_processed_job_data || {};
  const title = (hit.job_information?.title || 'Unknown Role').trim();
  const company =
    v5.company_name || hit.enriched_company_data?.company_name || hit.board_token || 'Unknown';
  const applyUrl = hit.apply_url || hit.hc_apply_url || '';
  const location = v5.formatted_workplace_location || 'not listed';
  const workType = v5.workplace_type || '';
  const seniority = v5.seniority_level || '';
  const minYoe = v5.is_min_industry_and_role_yoe_not_mentioned
    ? 'not mentioned'
    : (v5.min_industry_and_role_yoe ?? 'not mentioned');

  let salaryStr = 'not listed';
  if (v5.yearly_min_compensation || v5.yearly_max_compensation) {
    const cur = v5.listed_compensation_currency || '';
    const min = v5.yearly_min_compensation
      ? `$${Math.round(v5.yearly_min_compensation / 1000)}k`
      : '';
    const max = v5.yearly_max_compensation
      ? `$${Math.round(v5.yearly_max_compensation / 1000)}k`
      : '';
    salaryStr = [cur, min && max ? `${min}-${max}/yr` : min || max].filter(Boolean).join(' ');
  }

  const tools = (v5.technical_tools || []).join(', ') || 'not listed';
  const activities =
    (v5.role_activities || []).map(activity => `- ${activity}`).join('\n') || '- not listed';
  const companyTagline = hit.enriched_company_data?.company_tagline || v5.company_tagline || '';
  const companyActivities = (
    hit.enriched_company_data?.company_activities ||
    v5.company_activities ||
    []
  )
    .slice(0, 3)
    .join('; ');
  const visa =
    v5.visa_sponsorship === true ? 'yes' : v5.visa_sponsorship === false ? 'no' : 'unknown';

  return (
    `---
company: ${company}
role: ${title}
url: ${applyUrl}
source: hiring.cafe
fetched: ${today}
salary: ${salaryStr}
location: ${location}
type: ${workType}
seniority: ${seniority}
yoe_required: ${minYoe}
visa_sponsorship: ${visa}
jd_source: ${jdMethod}
summary_source: hiring.cafe-ai
---

## Hiring.cafe AI Summary

### Role Activities
${activities}

### Technical Tools
${tools}

### About ${company}
${companyTagline}
${companyActivities}

## Full Job Description
${fullJdText}`.trim() + '\n'
  );
}

export function createHiringCafeProvider({
  browserType = chromium,
  cachePath = CACHE_PATH,
  canonical = fetchCanonicalJobDescription,
  renderCanonical = fetchRenderedCanonicalJobDescription,
} = {}) {
  return {
    id: 'hiring-cafe',

    detect() {
      return null;
    },

    async fetch(entry, scanCtx) {
      const roles = Array.isArray(entry.search_roles)
        ? entry.search_roles
        : entry.search_role
          ? [entry.search_role]
          : [];

      if (roles.length === 0) {
        console.error('hiring-cafe: no search_roles defined in portals.yml entry');
        return [];
      }

      const today = new Date().toISOString().split('T')[0];
      const hitsByUrl = new Map();
      const cache = loadCache(cachePath);
      const freshMs = (entry.search_cache_ttl_hours || 12) * 60 * 60 * 1000;
      const fallbackMs = (entry.search_cache_fallback_days || 14) * 24 * 60 * 60 * 1000;
      let cacheDirty = false;
      let searchBlocked = false;

      let browser;
      try {
        for (const role of roles) {
          let hits = cachedHits(cache, role, freshMs);
          if (hits) {
            console.log(`  hiring-cafe: cached search results for "${role}"`);
          } else if (searchBlocked) {
            hits = cachedHits(cache, role, fallbackMs) || [];
            if (hits.length) console.log(`  hiring-cafe: stale-cache fallback for "${role}"`);
          } else {
            browser ||= await browserType.launch({ headless: true });
            const context = await browser.newContext({ userAgent: USER_AGENT });
            try {
              const page = await context.newPage();
              const response = await page.goto(`${BASE}/jobs/${roleSlug(role)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 45000,
              });
              if (!response?.ok()) throw new Error(`HTTP ${response?.status() || 'no response'}`);
              await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 10000 });

              hits = await page.evaluate(() => {
                const element = document.getElementById('__NEXT_DATA__');
                if (!element) return null;
                try {
                  return JSON.parse(element.textContent)?.props?.pageProps?.ssrHits ?? null;
                } catch {
                  return null;
                }
              });
              if (!Array.isArray(hits))
                throw new Error(
                  'Search page has no valid ssrHits; refusing to cache a challenge or malformed page',
                );
              cache.roles[role] = { fetchedAt: new Date().toISOString(), hits };
              cacheDirty = true;
              await delay(entry.search_pacing_ms ?? 400);
            } catch (err) {
              if (/HTTP (403|429)/.test(err.message)) searchBlocked = true;
              hits = cachedHits(cache, role, fallbackMs) || [];
              const fallback = hits.length ? ' — using cached results' : '';
              console.error(`hiring-cafe: search failed for "${role}": ${err.message}${fallback}`);
            } finally {
              await context.close();
            }
          }

          for (const hit of hits) {
            const applyUrl = hit.apply_url || hit.hc_apply_url || '';
            if (!applyUrl || hitsByUrl.has(applyUrl)) continue;

            const v5 = hit.v5_processed_job_data || {};
            if (!isCanadaEligible(v5)) continue;

            const title = (hit.job_information?.title || hit.job_title || '').trim();
            if (!title) continue;
            const company =
              v5.company_name ||
              hit.enriched_company_data?.company_name ||
              hit.board_token ||
              'Unknown';
            const location = v5.formatted_workplace_location || '';
            hitsByUrl.set(applyUrl, { hit, title, url: applyUrl, company, location });
          }
        }
      } finally {
        await browser?.close();
      }
      if (cacheDirty && !scanCtx?.dryRun) saveCache(cache, cachePath);

      const candidates = [...hitsByUrl.values()];
      const needsContent = candidates.filter(
        job => typeof scanCtx?.shouldFetchContent !== 'function' || scanCtx.shouldFetchContent(job),
      );
      const resolved = await mapWithHostLimits(
        needsContent,
        async job => {
          const full = await canonical(job.hit);
          if (full)
            console.log(
              `  hiring-cafe: full JD via ${full.method} for ${job.company} — ${job.title}`,
            );
          return full;
        },
        { concurrency: entry.jd_concurrency || 8, perHost: entry.jd_concurrency_per_host || 2 },
      );
      const unresolvedIndexes = resolved.flatMap((detail, index) => (detail ? [] : [index]));
      if (unresolvedIndexes.length) {
        const renderedBrowser = await browserType.launch({ headless: true });
        try {
          const rendered = await mapWithHostLimits(
            unresolvedIndexes.map(index => needsContent[index]),
            job => renderCanonical(job.url, renderedBrowser),
            { concurrency: 3, perHost: 1 },
          );
          for (let index = 0; index < unresolvedIndexes.length; index++) {
            resolved[unresolvedIndexes[index]] = rendered[index];
          }
        } finally {
          await renderedBrowser.close();
        }
      }
      const detailsByUrl = new Map(needsContent.map((job, index) => [job.url, resolved[index]]));

      return candidates.map(job => {
        const detail = detailsByUrl.get(job.url);
        return {
          title: job.title,
          url: job.url,
          company: job.company,
          location: job.location,
          content: detail ? buildContent(job.hit, today, detail.text, detail.method) : null,
          contentRequired: true,
        };
      });
    },
  };
}
export default createHiringCafeProvider();
