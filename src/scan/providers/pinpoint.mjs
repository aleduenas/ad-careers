/** Pinpoint public postings.json provider. */

import { fetchCanonicalJobDescription, mapWithHostLimits } from './_canonical-jd.mjs';
import { htmlToText } from './_http.mjs';

const PINPOINT_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pinpointhq\.com$/;

function resolveApiUrl(entry) {
  const raw = entry.api || entry.careers_url || '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!entry.api && !PINPOINT_HOST_RE.test(parsed.hostname)) return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/(?:postings\.json)?$/, '')}/postings.json`;
}

export function parsePinpointResponse(json, companyName) {
  if (!Array.isArray(json?.data)) return [];
  return json.data.flatMap(item => {
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const rawUrl = typeof item?.url === 'string' ? item.url.trim() : '';
    let url;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:') return [];
      url = parsed.href;
    } catch {
      return [];
    }
    if (!title) return [];
    const loc = item.location && typeof item.location === 'object' ? item.location : {};
    const location = loc.name || [loc.city, loc.province].filter(Boolean).join(', ');
    const inline = item.description || item.job?.description || null;
    return [{ title, url, company: companyName, location, content: htmlToText(inline) || null }];
  });
}

export default {
  id: 'pinpoint',

  detect(entry) {
    let host;
    try {
      host = new URL(entry.api || entry.careers_url || '').hostname;
    } catch {
      return null;
    }
    return PINPOINT_HOST_RE.test(host) && resolveApiUrl(entry) ? entry : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`pinpoint: cannot derive postings URL for ${entry.name}`);
    const jobs = parsePinpointResponse(await ctx.getJson(apiUrl), entry.name);
    if (!ctx.probe) {
      const needs = jobs.filter(
        job =>
          !job.content &&
          (typeof ctx.shouldFetchContent !== 'function' || ctx.shouldFetchContent(job)),
      );
      const resolved = await mapWithHostLimits(
        needs,
        job => fetchCanonicalJobDescription({ apply_url: job.url }),
        { concurrency: 5, perHost: 2 },
      );
      const byUrl = new Map(needs.map((job, index) => [job.url, resolved[index]?.text || null]));
      for (const job of jobs) job.content ||= byUrl.get(job.url) || null;
    }
    return jobs.map(job => ({ ...job, contentRequired: true }));
  },
};
