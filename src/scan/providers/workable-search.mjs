/** Cross-company discovery through the public Jobs by Workable search API. */
import { htmlToText } from './_http.mjs';

const BASE = 'https://jobs.workable.com';

export function normalizeWorkableSearchJob(raw) {
  if (raw?.state !== 'published' || !raw.title || !raw.company?.title) return null;
  let url;
  try {
    url = new URL(raw.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'jobs.workable.com' ||
      !url.pathname.startsWith('/view/')
    )
      return null;
  } catch {
    return null;
  }
  const locations = Array.isArray(raw.locations)
    ? raw.locations.filter(v => typeof v === 'string' && v !== 'TELECOMMUTE')
    : [];
  if (!locations.length && raw.location) {
    locations.push(
      [raw.location.city, raw.location.subregion, raw.location.countryName]
        .filter(Boolean)
        .join(', '),
    );
  }
  // Never turn an unspecified remote geography into an eligible Canadian job.
  if (!locations.some(Boolean)) return null;
  return {
    title: raw.title,
    company: raw.company.title,
    url: url.href,
    location: `${raw.workplace === 'remote' ? 'Remote - ' : ''}${locations.join(' / ')}`,
    content: [
      htmlToText(raw.description || ''),
      raw.requirementsSection ? `## Requirements\n\n${htmlToText(raw.requirementsSection)}` : '',
      raw.benefitsSection ? `## Benefits\n\n${htmlToText(raw.benefitsSection)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    contentRequired: true,
  };
}

export default {
  id: 'workable-search',
  detect() {
    return null;
  },
  async fetch(entry, ctx) {
    const terms = entry.search_terms || [];
    if (!terms.length) throw new Error('workable-search: configure search_terms');
    const maxPages = entry.max_pages_per_query || 25;
    const jobs = new Map();
    for (const query of terms) {
      let token = '';
      const tokens = new Set();
      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({ query, location: entry.search_location || 'Canada' });
        if (token) params.set('pageToken', token);
        // Any HTTP failure aborts this provider; no challenge bypass or retries.
        const response = await ctx.getJson(`${BASE}/api/v1/jobs?${params}`);
        if (!Array.isArray(response.jobs))
          throw new Error('workable-search: invalid search response');
        for (const raw of response.jobs) {
          const job = normalizeWorkableSearchJob(raw);
          if (
            job &&
            ((entry.search_location || 'Canada') !== 'Canada' || /\bCanada\b/i.test(job.location))
          )
            jobs.set(job.url, job);
        }
        token = response.nextPageToken;
        if (!token) break;
        if (tokens.has(token)) throw new Error('workable-search: repeated pagination token');
        tokens.add(token);
        if (page + 1 === maxPages)
          throw new Error(
            `workable-search: page limit reached for ${query}; increase max_pages_per_query`,
          );
      }
    }
    return [...jobs.values()];
  },
};
