/**
 * jobicy.mjs — Jobicy remote-jobs API provider (aggregator, keyless).
 *
 * portals.yml entry:
 *   - name: Jobicy
 *     provider: jobicy
 *     geo: canada                        # optional, default canada
 *     tags: ["data engineer", "python"]  # optional; one request per tag plus the untagged one
 *     require_location_any: [Canada]     # optional
 *
 * API: GET https://jobicy.com/api/v2/remote-jobs?count=100&geo=<geo>[&tag=<tag>]
 *   -> { jobs: [{ url, jobTitle, companyName, jobGeo, jobDescription (HTML) }] }
 * Jobicy asks for a visible credit and a direct link back; the data is for the private scan only.
 */

import { finishAggregator, getJsonOrLimit, remoteLocation, sleepFor } from './_aggregator.mjs';
import { htmlToText } from './_http.mjs';

export default {
  id: 'jobicy',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: jobicy`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const geo = entry.geo || 'canada';
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter(t => typeof t === 'string' && t)
      : [];
    const sleep = sleepFor(ctx);
    const jobs = [];
    let read = 0;
    let requests = 0;
    let limited = false;
    for (const tag of [null, ...tags]) {
      if (requests++ > 0) await sleep(entry.pacing_ms ?? 500);
      const url =
        `https://jobicy.com/api/v2/remote-jobs?count=100&geo=${encodeURIComponent(geo)}` +
        (tag ? `&tag=${encodeURIComponent(tag)}` : '');
      const { data, limited: stop } = await getJsonOrLimit(ctx, url);
      if (stop) {
        limited = true;
        break;
      }
      for (const j of Array.isArray(data?.jobs) ? data.jobs : []) {
        read++;
        jobs.push({
          title: j.jobTitle,
          url: j.url,
          company: j.companyName,
          location: remoteLocation(j.jobGeo),
          content: htmlToText(j.jobDescription) || null,
        });
      }
    }
    return finishAggregator('jobicy', ctx, entry, jobs, { requests, read, limited });
  },
};
