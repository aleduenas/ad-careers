/**
 * weworkremotely.mjs — We Work Remotely RSS provider (aggregator, keyless).
 *
 * portals.yml entry:
 *   - name: We Work Remotely
 *     provider: weworkremotely
 *     require_location_any: [Canada, Anywhere]   # optional
 *
 * Feed: GET https://weworkremotely.com/remote-jobs.rss (about 100 items). Each <item> has
 *   <title>"Company: Role"</title>, <region>, <country>, <link>, <description> (escaped HTML).
 * No XML library: a small item parser. The data is for the private scan only; credit We Work
 * Remotely as the source if it is ever shown.
 */

import { finishAggregator, remoteLocation, xmlTag } from './_aggregator.mjs';
import { htmlToText } from './_http.mjs';

export function parseRss(xml) {
  return String(xml)
    .split('<item>')
    .slice(1)
    .map(chunk => chunk.split('</item>')[0])
    .map(item => {
      const heading = xmlTag(item, 'title');
      const split = heading.indexOf(': ');
      const where = [...new Set([xmlTag(item, 'region'), xmlTag(item, 'country')].filter(Boolean))];
      return {
        title: split > 0 ? heading.slice(split + 2).trim() : heading,
        company: split > 0 ? heading.slice(0, split).trim() : '',
        url: xmlTag(item, 'link') || xmlTag(item, 'guid'),
        location: remoteLocation(where.join(', ')),
        content: htmlToText(xmlTag(item, 'description')) || null,
      };
    })
    .filter(job => job.title && job.url);
}

export default {
  id: 'weworkremotely',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: weworkremotely`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    let xml;
    try {
      xml = await ctx.get('https://weworkremotely.com/remote-jobs.rss');
    } catch (err) {
      if (/HTTP 429/.test(String(err?.message)))
        return finishAggregator('weworkremotely', ctx, entry, [], {
          requests: 1,
          read: 0,
          limited: true,
        });
      throw err;
    }
    if (!String(xml).includes('<item>')) throw new Error('weworkremotely: no items in feed');
    const jobs = parseRss(xml);
    return finishAggregator('weworkremotely', ctx, entry, jobs, { requests: 1, read: jobs.length });
  },
};
