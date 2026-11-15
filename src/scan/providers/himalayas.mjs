/**
 * himalayas.mjs — Himalayas remote-jobs search API provider.
 *
 * portals.yml entry:
 *   - name: Himalayas
 *     provider: himalayas
 *     search_terms: ["data engineer", "machine learning"]   # required
 *     country: CA                                           # optional, default CA
 *     max_pages_per_query: 3                                # optional, 20 jobs per page
 *     pacing_ms: 500                                        # optional pause between requests
 *
 * API (public, no key): GET https://himalayas.app/jobs/api/search?q=&country=&sort=recent&page=
 *   -> { jobs: [{ title, companyName, locationRestrictions[], applicationLink, description, guid }], totalCount }
 * Results are fuzzy, so only postings that pass ctx.passesFilters (title and location) are returned.
 * Himalayas asks that applications use `applicationLink` (used as the job URL) and that the source
 * is credited; this provider only feeds the private scan and never republishes the data.
 */

import { htmlToText } from './_http.mjs';

const BASE = 'https://himalayas.app/jobs/api/search';

function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase());
  } catch {
    return String(code);
  }
}

// The location gate reads this string. Worldwide and the searched country pass; a list that does
// not include the searched country (for example United States only) is kept as is and fails.
export function himalayasLocation(restrictions, country) {
  const list = Array.isArray(restrictions) ? restrictions.filter(Boolean) : [];
  if (list.length === 0) return 'Remote - Worldwide';
  const wanted = countryName(country);
  if (list.some(c => c.toLowerCase() === wanted.toLowerCase())) return `Remote - ${wanted}`;
  return `Remote - ${list.join(', ')}`;
}

export default {
  id: 'himalayas',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: himalayas`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const terms = Array.isArray(entry.search_terms) ? entry.search_terms.filter(Boolean) : [];
    if (terms.length === 0) throw new Error('himalayas: search_terms is required');
    const country = entry.country || 'CA';
    const maxPages = entry.max_pages_per_query ?? 3;
    const pacingMs = entry.pacing_ms ?? 500;
    const sleep = ms => (ctx.sleep ? ctx.sleep(ms) : new Promise(r => setTimeout(r, ms)));

    const seen = new Set();
    const out = [];
    let read = 0;
    let requests = 0;
    let limited = false;

    search: for (const term of terms) {
      for (let page = 1; page <= maxPages; page++) {
        if (requests++ > 0 && pacingMs) await sleep(pacingMs);
        let data;
        try {
          data = await ctx.getJson(
            `${BASE}?q=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&sort=recent&page=${page}`,
          );
        } catch (err) {
          // The shared allowance is not documented numerically: on 429 stop asking and keep
          // what was read; any other failure for a term ends only that term.
          if (/HTTP 429/.test(String(err?.message))) {
            limited = true;
            break search;
          }
          if (page === 1 && term === terms[0] && out.length === 0 && read === 0) throw err;
          break;
        }
        const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
        if (jobs.length === 0) break;
        for (const j of jobs) {
          read++;
          const url = j.applicationLink || j.guid;
          const id = j.guid || url;
          if (!url || !id || seen.has(id) || seen.has(url)) continue;
          seen.add(id);
          seen.add(url);
          const job = {
            title: j.title,
            url,
            company: j.companyName,
            location: himalayasLocation(j.locationRestrictions, country),
            content: htmlToText(j.description) || null,
          };
          if (ctx.passesFilters && !ctx.passesFilters(job)) continue;
          out.push(job);
        }
      }
    }
    console.log(
      `himalayas: ${terms.length} terms, ${requests} requests, ${read} postings read, ${out.length} passed filters${limited ? ' (stopped early: HTTP 429 rate limit)' : ''}`,
    );
    return out;
  },
};
