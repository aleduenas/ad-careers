/**
 * _aggregator.mjs — shared helpers for the keyless free job-board providers (jobicy, remoteok,
 * remotive, workingnomads, weworkremotely, hackernews, himalayas, smartrecruiters).
 * Files prefixed _ are helpers, not providers, and are skipped by the loader.
 */

import { buildLocationRequirement, normalizeLocationTerms } from './board-sweep.mjs';

export const isRateLimited = err => /HTTP 429/.test(String(err?.message ?? err));

// "Remote - <where>" for the location gate; a bare "Remote" when the source gives no place.
export function remoteLocation(where) {
  const text = String(where ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Remote';
  return /^remote\b/i.test(text) ? text : `Remote - ${text}`;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// A numeric entity outside the Unicode range becomes U+FFFD instead of throwing, so one
// malformed item cannot lose the whole feed.
function codePoint(n) {
  const code = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
}

export function unescapeXml(value) {
  return String(value ?? '')
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, name) => XML_ENTITIES[name])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, n) => codePoint(n))
    .trim();
}

// One tag's text out of an XML fragment (first occurrence), or ''.
export function xmlTag(fragment, tag) {
  const m = fragment.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? unescapeXml(m[1]) : '';
}

// GET JSON; a 429 is reported as { limited: true } so the caller can stop politely.
export async function getJsonOrLimit(ctx, url) {
  try {
    return { data: await ctx.getJson(url) };
  } catch (err) {
    if (isRateLimited(err)) return { limited: true };
    throw err;
  }
}

// Filters the postings, drops duplicates by URL, applies the optional require_location_any list,
// prints the one summary line and returns the jobs. Absent hooks (tests) pass everything.
export function finishAggregator(
  id,
  ctx,
  entry,
  jobs,
  { requests = 1, read = jobs.length, limited = false } = {},
) {
  const location = buildLocationRequirement(entry.require_location_any);
  if (
    entry.require_location_any != null &&
    normalizeLocationTerms(entry.require_location_any).length === 0
  )
    console.log(`${id}: require_location_any has no usable entry; no location requirement applied`);
  const seen = new Set();
  const out = [];
  let dropped = 0;
  for (const job of jobs) {
    if (!job?.url || seen.has(job.url)) continue;
    if (ctx.passesFilters && !ctx.passesFilters(job)) continue;
    if (!location(job.location)) {
      dropped++;
      continue;
    }
    seen.add(job.url);
    out.push(job);
  }
  console.log(
    `${id}: ${requests} requests, ${read} postings read, ${out.length} passed filters` +
      (entry.require_location_any != null ? `, ${dropped} dropped by require_location_any` : '') +
      (limited ? ' (stopped early: HTTP 429 rate limit)' : ''),
  );
  return out;
}

export const sleepFor = ctx => ms =>
  ctx.sleep ? ctx.sleep(ms) : new Promise(resolve => setTimeout(resolve, ms));
