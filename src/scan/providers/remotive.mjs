/**
 * remotive.mjs — Remotive remote-jobs API provider (aggregator, keyless).
 *
 * portals.yml entry:
 *   - name: Remotive
 *     provider: remotive
 *     min_interval_hours: 6              # optional; Remotive advises at most 4 requests a day
 *     require_location_any: [Canada]     # optional
 *
 * API: GET https://remotive.com/api/remote-jobs (one request per scan)
 *   -> { "0-legal-notice", "job-count", jobs: [{ title, company_name, candidate_required_location,
 *        description (HTML), url }] }
 * The notice asks for a link back to the Remotive URL and a mention of Remotive as the source,
 * forbids passing the jobs on to third-party sites, delays jobs by 24 hours and says data only
 * changes a couple of times a day (advice: at most 4 requests a day; excessive requests are
 * blocked). So a real scan is skipped when the last fetch was less than `min_interval_hours` ago
 * (state in data/remotive-state.json, never written by a dry run). Private use only.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { root } from '../../lib/root.mjs';
import { finishAggregator, getJsonOrLimit, remoteLocation } from './_aggregator.mjs';
import { htmlToText } from './_http.mjs';

const stateFile = entry => path.resolve(root, entry.state_file || 'data/remotive-state.json');

function lastFetch(file) {
  try {
    const t = Date.parse(JSON.parse(readFileSync(file, 'utf8')).lastFetch);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export default {
  id: 'remotive',
  aggregator: true,

  // Never auto-detected: always selected with an explicit `provider: remotive`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const file = stateFile(entry);
    const nowMs = (ctx.now ?? Date.now)();
    const minMs = (entry.min_interval_hours ?? 6) * 3_600_000;
    const last = lastFetch(file);
    if (last !== null && nowMs - last < minMs) {
      console.log(
        `remotive: skipped, last fetch ${Math.round((nowMs - last) / 60000)} minutes ago (Remotive advises at most 4 requests a day)`,
      );
      return [];
    }
    const { data, limited } = await getJsonOrLimit(ctx, 'https://remotive.com/api/remote-jobs');
    if (limited)
      return finishAggregator('remotive', ctx, entry, [], { requests: 1, read: 0, limited });
    if (!data || !Array.isArray(data.jobs)) throw new Error('remotive: invalid response');
    if (!ctx.dryRun) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({ lastFetch: new Date(nowMs).toISOString() }) + '\n',
        'utf8',
      );
    }
    const jobs = data.jobs.map(j => ({
      title: j.title,
      url: j.url,
      company: j.company_name,
      location: remoteLocation(j.candidate_required_location),
      content: htmlToText(j.description) || null,
    }));
    return finishAggregator('remotive', ctx, entry, jobs, { requests: 1, read: jobs.length });
  },
};
