/** SAP SuccessFactors Recruiting Marketing (RMK) public-board provider. */

import { fetchCanonicalJobDescription, mapWithHostLimits } from './_canonical-jd.mjs';
import { htmlToText } from './_http.mjs';

const MAX_PAGES = 40;

function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const basePath = parsed.pathname
    .replace(/\/(?:search|tile-search-results)\/?$/i, '')
    .replace(/\/+$/, '');
  return { base: parsed.origin + basePath, origin: parsed.origin };
}

function clean(value) {
  return htmlToText(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugWords(value) {
  return clean(value)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '');
}

export function inferSuccessFactorsLocation(path, title) {
  let postingSlug = '';
  try {
    const pathname = new URL(path, 'https://jobs.example.invalid').pathname;
    postingSlug = decodeURIComponent(pathname.split('/').filter(Boolean)[1] || '');
  } catch {
    return '';
  }
  const titleSlug = slugWords(title);
  const titleIndex = titleSlug ? postingSlug.toLowerCase().indexOf(titleSlug.toLowerCase()) : -1;
  const locationSlug =
    titleIndex > 0
      ? postingSlug.slice(0, titleIndex).replace(/-+$/, '')
      : postingSlug.split('-')[0];
  return locationSlug.replace(/-+/g, ' ').trim();
}

export function parseSuccessFactorsTiles(html, origin) {
  const jobs = [];
  const tileRe = /<li class=["'][^"']*job-tile job-id-(\d+)[^"']*["'][\s\S]*?<\/li>/gi;
  for (const match of html.matchAll(tileRe)) {
    const block = match[0];
    const path = block.match(/data-url=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;', '&');
    const title = clean(
      block.match(/class=["'][^"']*jobTitle-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1],
    );
    if (!path || !title) continue;
    const location =
      clean(block.match(/id=["'][^"']*-section-city-value["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]) ||
      inferSuccessFactorsLocation(path, title);
    jobs.push({
      id: match[1],
      title,
      url: /^https?:\/\//i.test(path) ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`,
      location,
    });
  }
  return jobs;
}

export default {
  id: 'successfactors',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    return /successfactors\.(?:com|eu)|jobs2web\.com/i.test(url) ? entry : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`successfactors: cannot resolve board for ${entry.name}`);
    const seen = new Set();
    const jobs = [];
    let startrow = 0;
    const maxPages = Math.min(Number(entry.max_pages) || MAX_PAGES, ctx.probe ? 1 : MAX_PAGES);
    for (let page = 0; page < maxPages; page++) {
      const html = await ctx.get(`${cfg.base}/tile-search-results/?startrow=${startrow}`);
      const rows = parseSuccessFactorsTiles(html, cfg.origin);
      if (!rows.length) break;
      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        jobs.push({ ...row, company: entry.name });
      }
      if (!fresh) break;
      startrow += rows.length;
    }
    if (!ctx.probe) {
      const needs = jobs.filter(
        job => typeof ctx.shouldFetchContent !== 'function' || ctx.shouldFetchContent(job),
      );
      const resolved = await mapWithHostLimits(
        needs,
        job => fetchCanonicalJobDescription({ apply_url: job.url }),
        { concurrency: 5, perHost: 2 },
      );
      const byUrl = new Map(needs.map((job, index) => [job.url, resolved[index]?.text || null]));
      for (const job of jobs) job.content = byUrl.get(job.url) || null;
    }
    return jobs.map(({ id: _id, ...job }) => ({ ...job, contentRequired: true }));
  },
};
