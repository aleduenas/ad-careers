/**
 * remoteok.mjs — Remote OK API provider (aggregator, keyless).
 *
 * portals.yml entry:
 *   - name: Remote OK
 *     provider: remoteok
 *     require_location_any: [Canada, Americas]   # optional
 *
 * API: GET https://remoteok.com/api -> array; element 0 is the legal notice.
 *   Postings: { position, company, location, description (HTML), url }.
 * Remote OK requires a followed link back to the posting and a mention of Remote OK as the source
 * (and no use of its logo); the data is for the private scan only and is never republished.
 */

import { finishAggregator, getJsonOrLimit, remoteLocation } from './_aggregator.mjs';
import { htmlToText } from './_http.mjs';

export default {
  id: 'remoteok',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: remoteok`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const { data, limited } = await getJsonOrLimit(ctx, 'https://remoteok.com/api');
    if (limited)
      return finishAggregator('remoteok', ctx, entry, [], { requests: 1, read: 0, limited });
    if (!Array.isArray(data)) throw new Error('remoteok: invalid response');
    const postings = data.filter(j => j && j.position && j.url);
    const jobs = postings.map(j => ({
      title: j.position,
      url: j.url,
      company: j.company,
      location: remoteLocation(j.location),
      content: htmlToText(j.description) || null,
    }));
    return finishAggregator('remoteok', ctx, entry, jobs, { requests: 1, read: postings.length });
  },
};
