/**
 * hackernews.mjs — "Ask HN: Who is hiring?" provider (aggregator, keyless, Algolia HN API).
 *
 * portals.yml entry:
 *   - name: Hacker News Who is hiring
 *     provider: hackernews
 *     require_location_any: [Canada, Toronto, Remote]   # optional
 *
 * API: GET https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring finds the
 *   newest "Ask HN: Who is hiring?" story; GET https://hn.algolia.com/api/v1/items/<id> returns
 *   it with its comments. Each top-level comment is one posting. The first line is usually
 *   "Company | Role | Location | ...": company = first segment; title = the first remaining
 *   header segment that passes ctx.passesFilters, else the first short body line that does (no
 *   match: skipped); location = the other header segments joined. URL is the comment page.
 * The data is for the private scan only; credit Hacker News / Y Combinator if it is ever shown.
 */

import { finishAggregator, getJsonOrLimit } from './_aggregator.mjs';
import { htmlToText } from './_http.mjs';

const TITLE_RE = /^Ask HN: Who is hiring\?/i;

export function parseComment(comment, passes = () => true) {
  // HN separates paragraphs with bare <p> tags (no closing tag); make them line breaks first.
  const text = htmlToText((comment.text || '').replace(/<p>/gi, '\n\n')).trim();
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const header = lines[0] || '';
  const segments = header
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);
  // A posting header is "Company | Role | Location | ..."; fewer than three parts is a remark,
  // not a posting.
  if (segments.length < 3) return null;
  const company = segments[0];
  const rest = segments.slice(1);
  let title = rest.find(seg => passes({ title: seg, location: '' }));
  let titleIndex = title === undefined ? -1 : rest.indexOf(title);
  if (title === undefined) {
    title = lines
      .slice(1)
      .map(line => line.replace(/^[-*•·]+\s*/, ''))
      .find(line => line.length <= 100 && passes({ title: line, location: '' }));
    if (title === undefined) return null;
  }
  const location = rest.filter((_, i) => i !== titleIndex).join(', ');
  return {
    title,
    url: `https://news.ycombinator.com/item?id=${comment.id}`,
    company,
    location,
    content: text,
  };
}

export default {
  id: 'hackernews',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: hackernews`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const list = await getJsonOrLimit(
      ctx,
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10',
    );
    if (list.limited)
      return finishAggregator('hackernews', ctx, entry, [], {
        requests: 1,
        read: 0,
        limited: true,
      });
    const story = (list.data?.hits || []).find(h => TITLE_RE.test(h.title || ''));
    if (!story) throw new Error('hackernews: no "Who is hiring?" story found');
    const thread = await getJsonOrLimit(
      ctx,
      `https://hn.algolia.com/api/v1/items/${story.objectID}`,
    );
    if (thread.limited)
      return finishAggregator('hackernews', ctx, entry, [], {
        requests: 2,
        read: 0,
        limited: true,
      });
    const comments = Array.isArray(thread.data?.children) ? thread.data.children : [];
    const passes = ctx.passesFilters ? job => ctx.passesFilters(job) : () => true;
    const jobs = comments.map(c => parseComment(c, passes)).filter(Boolean);
    return finishAggregator('hackernews', ctx, entry, jobs, { requests: 2, read: comments.length });
  },
};
