/**
 * smartrecruiters.mjs — SmartRecruiters public posting API provider (direct employer board).
 *
 * portals.yml entry:
 *   - name: Loblaw Digital
 *     provider: smartrecruiters
 *     company_id: LoblawDigital
 *
 * API (public, keyless):
 *   GET https://api.smartrecruiters.com/v1/companies/<id>/postings?limit=100&offset=
 *     -> { totalFound, content: [{ id, name, location: { fullLocation, remote }, ... }] }
 *   GET https://api.smartrecruiters.com/v1/companies/<id>/postings/<postingId>
 *     -> { postingUrl, jobAd: { sections: { companyDescription, jobDescription, qualifications,
 *          additionalInformation } } }
 * The detail is fetched only for stubs that pass ctx.passesFilters and ctx.shouldFetchContent.
 * Unlike the aggregators this is the employer's own board, so it is a direct source in scan.mjs.
 */

import { htmlToText } from './_http.mjs';

const PAGE = 100;
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 4;
const SECTIONS = [
  'companyDescription',
  'jobDescription',
  'qualifications',
  'additionalInformation',
];

const slug = value =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function postingContent(detail) {
  const sections = detail?.jobAd?.sections || {};
  return (
    SECTIONS.map(key => sections[key])
      .filter(section => section?.text)
      .map(section => `${section.title ? `${section.title}\n` : ''}${htmlToText(section.text)}`)
      .join('\n\n') || null
  );
}

export default {
  id: 'smartrecruiters',

  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const id = entry.company_id;
    if (!id || !/^[A-Za-z0-9_-]+$/.test(String(id)))
      throw new Error('smartrecruiters: company_id is required');
    const base = `https://api.smartrecruiters.com/v1/companies/${id}/postings`;

    const stubs = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await ctx.getJson(`${base}?limit=${PAGE}&offset=${page * PAGE}`);
      const batch = Array.isArray(data?.content) ? data.content : null;
      if (!batch) throw new Error('smartrecruiters: invalid list response');
      stubs.push(...batch);
      if (batch.length < PAGE || stubs.length >= (data.totalFound ?? 0)) break;
      if (page === MAX_PAGES - 1)
        throw new Error('smartrecruiters: page cap reached; incomplete results');
    }

    const out = [];
    let failed = 0;
    let next = 0;
    async function worker() {
      while (next < stubs.length) {
        const stub = stubs[next++];
        const loc = stub.location || {};
        const where =
          loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
        const location = loc.remote ? (where ? `Remote - ${where}` : 'Remote') : where || '';
        const job = {
          title: stub.name,
          url: `https://jobs.smartrecruiters.com/${id}/${stub.id}-${slug(stub.name)}`,
          company: entry.name,
          location,
          content: null,
        };
        if (ctx.passesFilters && !ctx.passesFilters(job)) continue;
        if (ctx.shouldFetchContent && !ctx.shouldFetchContent(job)) continue;
        try {
          const detail = await ctx.getJson(`${base}/${stub.id}`);
          out.push({ ...job, url: detail.postingUrl || job.url, content: postingContent(detail) });
        } catch {
          failed++; // left out: nothing is recorded, the next scan retries it
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, stubs.length) }, worker));
    if (failed > 0)
      console.log(
        `smartrecruiters: ${entry.name}: ${failed} postings skipped this run (detail unavailable)`,
      );
    return out;
  },
};
