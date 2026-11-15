/**
 * breezy.mjs — Breezy HR job board provider.
 *
 * Detects: portals.yml entries with `breezy_board` (e.g. zero-hash) or a careers_url on
 *          *.breezy.hr (https://{board}.breezy.hr/...).
 * API:     GET https://{board}.breezy.hr/json
 *          Returns an array of postings: { name, url, location: { name }, ... }.
 * The full description is read from the posting page (JSON-LD JobPosting, else the
 * description block), only when ctx.shouldFetchContent(job) allows it.
 */

import { htmlToText } from './_http.mjs';

function boardOf(entry) {
  if (entry.breezy_board) return String(entry.breezy_board).trim();
  try {
    const host = new URL(entry.careers_url).hostname.toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.breezy\.hr$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function descriptionOf(page) {
  for (const m of page.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item?.['@type'] === 'JobPosting' && item.description) return item.description;
      }
    } catch {
      // not JSON-LD we can read; try the next block
    }
  }
  const block = page.match(
    /<div[^>]*class="[^"]*\bdescription\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  return block ? block[1] : null;
}

export default {
  id: 'breezy',

  detect(entry) {
    return boardOf(entry) ? entry : null;
  },

  async fetch(entry, ctx) {
    const board = boardOf(entry);
    if (!board) throw new Error('breezy: cannot derive board from breezy_board or careers_url');

    const list = await ctx.getJson(`https://${board}.breezy.hr/json`);
    if (!Array.isArray(list)) throw new Error('breezy: invalid list response');

    const LIMIT = 5;
    const out = new Array(list.length);
    let i = 0;
    async function worker() {
      while (i < list.length) {
        const idx = i++;
        const j = list[idx];
        const job = {
          title: j.name,
          url: j.url,
          company: entry.name,
          location: j.location?.name || (j.location?.is_remote ? 'Remote' : ''),
          content: null,
        };
        if (j.url && (!ctx.shouldFetchContent || ctx.shouldFetchContent(job))) {
          try {
            job.content = htmlToText(descriptionOf(await ctx.get(j.url))) || null;
          } catch {
            // content stays null; scan.mjs defers the posting as "Missing full JD"
          }
        }
        out[idx] = job;
      }
    }
    await Promise.all(Array.from({ length: Math.min(LIMIT, list.length) }, worker));
    return out;
  },
};
