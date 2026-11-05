/**
 * greenhouse-api.mjs — Greenhouse job board provider.
 *
 * Detects: portals.yml entries where `api` contains boards-api.greenhouse.io
 * API docs: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 */

import { htmlToText } from './_http.mjs';

export default {
  id: 'greenhouse',

  detect(entry) {
    return entry.greenhouse_board || entry.api?.includes('boards-api.greenhouse.io') ? entry : null;
  },

  async fetch(entry, ctx) {
    const base =
      entry.api || `https://boards-api.greenhouse.io/v1/boards/${entry.greenhouse_board}/jobs`;
    const url = base.includes('?') ? base : `${base}?content=true`;
    const data = await ctx.getJson(url);
    return (data.jobs || []).map(j => ({
      title: j.title,
      url: j.absolute_url,
      company: entry.name,
      location: j.location?.name || '',
      content: htmlToText(j.content) || null,
    }));
  },
};
