/**
 * Workable public job-board provider.
 *
 * Workable exposes a no-auth markdown feed at /{account}/jobs.md. Detail links
 * in that feed have their own .md representation, which gives this scanner a
 * complete JD without using a browser or an authenticated API.
 */

import { htmlToText } from './_http.mjs';

function resolveFeedUrl(entry) {
  const raw = entry.workable_board
    ? `https://apply.workable.com/${entry.workable_board}/`
    : entry.careers_url;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'apply.workable.com') return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  return slug ? `https://apply.workable.com/${slug}/jobs.md` : null;
}

export function parseWorkableMarkdown(text, companyName) {
  if (typeof text !== 'string') return [];
  const jobs = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes('[View]')) continue;
    const cols = line.split('|').map(value => value.trim());
    const title = cols[1];
    if (!title || title === 'Title') continue;
    const match = line.match(/\[View\]\(([^)]+)\)/);
    const detailFeed = match?.[1] || '';
    let publicUrl = detailFeed.endsWith('.md') ? detailFeed.slice(0, -3) : detailFeed;
    try {
      const parsed = new URL(publicUrl);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'apply.workable.com') continue;
      publicUrl = parsed.href;
    } catch {
      continue;
    }
    jobs.push({
      title,
      url: publicUrl,
      company: companyName,
      location: cols[3] || '',
      _detailFeed: detailFeed,
    });
  }
  return jobs;
}

function isDirectory(text) {
  return /Use the search endpoint to filter results/i.test(text);
}

export function parseWorkableCountries(text) {
  const section = text.match(/^## Locations\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] || '';
  return [...new Set([...section.matchAll(/^- ([^:\r\n]+):/gm)].map(match => match[1].trim()))];
}

export default {
  id: 'workable',

  detect(entry) {
    return resolveFeedUrl(entry) ? entry : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = resolveFeedUrl(entry);
    if (!feedUrl) throw new Error(`workable: cannot derive feed URL for ${entry.name}`);
    const initial = await ctx.get(feedUrl);
    let jobs = parseWorkableMarkdown(initial, entry.name);
    if (isDirectory(initial)) {
      const countries = parseWorkableCountries(initial);
      if (!countries.length || countries.length > 50) {
        throw new Error(`workable: cannot enumerate country directory for ${entry.name}`);
      }
      for (const country of countries) {
        const countryUrl = new URL(feedUrl);
        countryUrl.searchParams.set('location[0][country]', country);
        const countryFeed = await ctx.get(countryUrl.href);
        if (isDirectory(countryFeed)) {
          throw new Error(
            `workable: country filter did not resolve directory for ${entry.name}: ${country}`,
          );
        }
        jobs.push(...parseWorkableMarkdown(countryFeed, entry.name));
      }
      jobs = [...new Map(jobs.map(job => [job.url, job])).values()];
    }
    for (const job of jobs) {
      const wanted = typeof ctx.shouldFetchContent !== 'function' || ctx.shouldFetchContent(job);
      if (!ctx.probe && wanted && job._detailFeed) {
        try {
          job.content = htmlToText(await ctx.get(job._detailFeed));
        } catch {
          job.content = null;
        }
      }
      job.contentRequired = true;
      delete job._detailFeed;
    }
    return jobs;
  },
};
