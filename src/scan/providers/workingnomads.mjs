/**
 * workingnomads.mjs — Working Nomads exposed jobs API provider (aggregator, keyless).
 *
 * portals.yml entry:
 *   - name: Working Nomads
 *     provider: workingnomads
 *     require_location_any: [Canada]     # optional
 *
 * API: GET https://www.workingnomads.com/api/exposed_jobs/ -> array of
 *   { title, company_name, location, description (HTML), url }.
 * The data is for the private scan only; credit Working Nomads as the source if it is ever shown.
 */

import { finishAggregator, getJsonOrLimit, remoteLocation } from './_aggregator.mjs';
import { htmlToText } from './_http.mjs';

export default {
  id: 'workingnomads',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: workingnomads`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const { data, limited } = await getJsonOrLimit(
      ctx,
      'https://www.workingnomads.com/api/exposed_jobs/',
    );
    if (limited)
      return finishAggregator('workingnomads', ctx, entry, [], { requests: 1, read: 0, limited });
    if (!Array.isArray(data)) throw new Error('workingnomads: invalid response');
    const postings = data.filter(j => j && j.title && j.url);
    const jobs = postings.map(j => ({
      title: j.title,
      url: j.url,
      company: j.company_name,
      location: remoteLocation(j.location),
      content: htmlToText(j.description) || null,
    }));
    return finishAggregator('workingnomads', ctx, entry, jobs, {
      requests: 1,
      read: postings.length,
    });
  },
};
