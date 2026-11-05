/**
 * icims-api.mjs — iCIMS-hosted career site provider (JD-detail fetch only).
 *
 * iCIMS has no single public "list every open job" endpoint that works the
 * same way across tenants (unlike Greenhouse/Ashby/Lever) — the search UI is
 * tenant-specific and often requires a session. What iCIMS job *detail* pages
 * do reliably expose, server-rendered in plain HTML, is a schema.org
 * `JobPosting` JSON-LD block with the full description — so this provider
 * fetches known job URLs directly rather than discovering new ones.
 *
 * portals.yml entry:
 *   - name: KPMG Canada
 *     provider: icims
 *     job_urls:
 *       - "https://careers.kpmg.ca/jobs/31962?lang=en-us"
 *     enabled: true
 *
 * When a new posting URL turns up (pasted by the user, or found via
 * WebSearch elsewhere), add it to job_urls and the next scan will cache it —
 * this does not discover postings on its own.
 */

import { htmlToText } from './_http.mjs';

function extractJobPosting(html) {
  const scripts = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of scripts) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const candidates = Array.isArray(data) ? data : [data];
    for (const c of candidates) {
      if (c?.['@type'] === 'JobPosting') return c;
    }
  }
  return null;
}

function formatLocation(jp) {
  const places = Array.isArray(jp.jobLocation) ? jp.jobLocation : [jp.jobLocation].filter(Boolean);
  return places
    .map(p => {
      const a = p?.address || {};
      return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join(' / ');
}

export default {
  id: 'icims',

  detect() {
    return null;
  }, // requires explicit `provider: icims` in portals.yml

  async fetch(entry, ctx) {
    const urls = entry.job_urls || [];
    if (urls.length === 0) {
      console.error(`icims: no job_urls defined for "${entry.name}"`);
      return [];
    }

    const jobs = [];
    for (const url of urls) {
      let html;
      try {
        html = await ctx.get(url);
      } catch (err) {
        console.error(`icims: fetch failed for ${url} — ${err.message}`);
        continue;
      }
      const jp = extractJobPosting(html);
      if (!jp) {
        console.error(`icims: no JobPosting JSON-LD found at ${url} (posting may be closed)`);
        continue;
      }
      jobs.push({
        title: jp.title || 'Unknown Role',
        url,
        company: entry.name,
        location: formatLocation(jp),
        content: jp.description ? htmlToText(jp.description) : null,
      });
    }
    return jobs;
  },
};
