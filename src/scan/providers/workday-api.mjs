/**
 * workday-api.mjs — Workday (myworkdayjobs.com) job board provider.
 *
 * Detects: portals.yml entries where careers_url contains myworkdayjobs.com,
 * OR entries with an explicit `provider: workday` plus `workday_tenant`,
 * `workday_host`, `workday_site` fields (needed when the public careers_url
 * is a marketing page that only redirects into Workday, e.g. Accenture).
 *
 * portals.yml entry:
 *   - name: Accenture Canada
 *     provider: workday
 *     workday_tenant: accenture
 *     workday_host: wd103
 *     workday_site: AccentureCareers
 *     workday_search_terms: ["Data", "Machine Learning", "AI"]   # optional
 *     workday_search_all: true                                   # optional, full board; skips country facet
 *     workday_country: Canada                                    # optional, default Canada
 *     enabled: true
 *
 * API (public, unauthenticated, zero LLM tokens):
 *   POST https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
 *     body: { appliedFacets, limit, offset, searchText }
 *     first call (no facets) is used to resolve the country facet id from the
 *     locationCountry facet group, so no GUID needs to be hardcoded in portals.yml.
 *   GET  https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}
 *     returns { jobPostingInfo: { title, location, jobDescription (HTML), externalUrl } }
 */

import { htmlToText } from './_http.mjs';

const DEFAULT_TERMS = ['Data', 'Engineer', 'Scientist', 'Machine Learning', 'AI'];
const PAGE_LIMIT = 20; // Workday CXS API rejects limit > 20 with HTTP 400
const MAX_PAGES_PER_TERM = 10; // cap at 200 hits per term before filtering

function wdUrl(tenant, host) {
  return `https://${tenant}.${host}.myworkdayjobs.com`;
}

async function resolveCountryFacetId(base, tenant, site, countryName, ctx) {
  const res = await ctx.postJson(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
    appliedFacets: {},
    limit: 1,
    offset: 0,
    searchText: countryName,
  });
  for (const facet of res.facets || []) {
    if (facet.facetParameter !== 'locationMainGroup') continue;
    for (const group of facet.values || []) {
      if (group.facetParameter !== 'locationCountry') continue;
      const hit = (group.values || []).find(
        v => v.descriptor?.toLowerCase() === countryName.toLowerCase(),
      );
      if (hit) return hit.id;
    }
  }
  return null;
}

export default {
  id: 'workday',

  detect(entry) {
    if (entry.careers_url?.includes('myworkdayjobs.com')) return entry;
    return null;
  },

  async fetch(entry, ctx) {
    const tenant = entry.workday_tenant;
    const host = entry.workday_host;
    const site = entry.workday_site;
    if (!tenant || !host || !site) {
      throw new Error('workday: missing workday_tenant/workday_host/workday_site in portals.yml');
    }

    const base = wdUrl(tenant, host);
    const countryName = entry.workday_country || 'Canada';
    const terms = entry.workday_search_all
      ? ['']
      : entry.workday_search_terms?.length
        ? entry.workday_search_terms
        : DEFAULT_TERMS;

    const countryId = entry.workday_search_all
      ? null
      : await resolveCountryFacetId(base, tenant, site, countryName, ctx);
    const appliedFacets = countryId ? { locationCountry: [countryId] } : {};

    const seenPaths = new Set();
    const stubs = [];

    for (const term of terms) {
      let offset = 0;
      for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
        const res = await ctx.postJson(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
          appliedFacets,
          limit: PAGE_LIMIT,
          offset,
          searchText: term,
        });
        const postings = res.jobPostings || [];
        for (const p of postings) {
          if (!p.externalPath || seenPaths.has(p.externalPath)) continue;
          seenPaths.add(p.externalPath);
          stubs.push(p);
        }
        offset += PAGE_LIMIT;
        if (postings.length < PAGE_LIMIT || offset >= (res.total || 0)) break;
        if (page === MAX_PAGES_PER_TERM - 1) {
          throw new Error(
            `workday: incomplete results for ${JSON.stringify(term)} (${offset}/${res.total}); narrow the search terms`,
          );
        }
      }
    }

    // Fetch full detail (description) for each unique posting — bounded concurrency via ctx if available
    const LIMIT = 5;
    const detailed = new Array(stubs.length);
    let i = 0;
    async function worker() {
      while (i < stubs.length) {
        const idx = i++;
        const stub = stubs[idx];
        try {
          const detail = await ctx.getJson(
            `${base}/wday/cxs/${tenant}/${site}${stub.externalPath}`,
          );
          const jp = detail.jobPostingInfo || {};
          detailed[idx] = {
            title: jp.title || stub.title,
            url: jp.externalUrl || `${base}/${site}${stub.externalPath}`,
            company: entry.name,
            location:
              [...new Set([jp.location, ...(jp.additionalLocations || [])].filter(Boolean))].join(
                '; ',
              ) ||
              stub.locationsText ||
              '',
            content: htmlToText(jp.jobDescription) || null,
          };
        } catch {
          detailed[idx] = {
            title: stub.title,
            url: `${base}/${site}${stub.externalPath}`,
            company: entry.name,
            location: stub.locationsText || '',
            content: null,
          };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(LIMIT, stubs.length) }, worker));

    return detailed;
  },
};
