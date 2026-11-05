/**
 * lever-api.mjs — Lever job board provider.
 *
 * Detects: portals.yml entries where careers_url contains jobs.lever.co/{slug}
 * API:     GET https://api.lever.co/v0/postings/{slug}?mode=json&limit=250
 *          Returns an array of posting objects.
 */

import { htmlToText } from './_http.mjs';

export default {
  id: 'lever',

  detect(entry) {
    return entry.careers_url?.includes('jobs.lever.co/') ? entry : null;
  },

  async fetch(entry, ctx) {
    const slug = entry.careers_url.split('jobs.lever.co/')[1]?.replace(/\/$/, '');
    if (!slug) throw new Error('lever: cannot derive slug from careers_url');

    const data = [],
      seen = new Set(),
      limit = 250,
      maxPages = entry.max_pages || 100;
    for (let page = 0; page < maxPages; page++) {
      const batch = await ctx.getJson(
        `https://api.lever.co/v0/postings/${slug}?mode=json&limit=${limit}&skip=${page * limit}`,
      );
      if (!Array.isArray(batch)) throw new Error('lever: invalid list response');
      for (const job of batch) {
        const key = job.id || job.hostedUrl;
        if (seen.has(key)) throw new Error('lever: repeated posting across pages');
        seen.add(key);
        data.push(job);
      }
      if (batch.length < limit) break;
      if (page === maxPages - 1) throw new Error('lever: page cap reached; incomplete results');
    }
    return data.map(j => ({
      title: j.text,
      url: j.hostedUrl,
      company: entry.name,
      location: j.categories?.location || j.categories?.team || j.workplaceType || '',
      content:
        htmlToText(
          [
            j.descriptionPlain || j.description,
            ...(j.lists || []).flatMap(s => [s.text, s.content]),
            j.additionalPlain || j.additional,
          ]
            .filter(Boolean)
            .join('\n\n'),
        ) || null,
    }));
  },
};
