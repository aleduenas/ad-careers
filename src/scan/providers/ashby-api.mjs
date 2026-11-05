/**
 * ashby-api.mjs — Ashby job board provider.
 *
 * Detects: portals.yml entries where careers_url contains jobs.ashbyhq.com/{slug}
 * API:     GET https://api.ashbyhq.com/posting-api/job-board/{slug}
 *          Returns { jobPostings: [{ id, title, isRemote, location, jobUrl, ... }] }
 */

import { htmlToText } from './_http.mjs';

export default {
  id: 'ashby',

  detect(entry) {
    return entry.ashby_board || entry.careers_url?.includes('jobs.ashbyhq.com/') ? entry : null;
  },

  async fetch(entry, ctx) {
    const slug =
      entry.ashby_board || entry.careers_url?.split('jobs.ashbyhq.com/')[1]?.replace(/\/$/, '');
    if (!slug) throw new Error('ashby: cannot derive slug from careers_url');

    const data = await ctx.getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    const jobs = data.jobs || data.jobPostings || [];

    // Fetch full descriptions in parallel — max 5 concurrent to avoid rate limits
    const LIMIT = 5;
    const detailed = new Array(jobs.length);
    let i = 0;
    async function worker() {
      while (i < jobs.length) {
        const idx = i++;
        const j = jobs[idx];
        let content = j.descriptionHtml || j.description || null;
        if (!content && j.id) {
          try {
            const detail = await ctx.getJson(
              `https://api.ashbyhq.com/posting-api/job-board/${slug}/job-posting?jobPostingId=${j.id}`,
            );
            content = detail.descriptionHtml || detail.description || null;
          } catch {
            // ignore — content stays null, JD won't be cached for this job
          }
        }
        detailed[idx] = { ...j, _content: htmlToText(content) };
      }
    }
    await Promise.all(Array.from({ length: Math.min(LIMIT, jobs.length) }, worker));

    return detailed.map(j => ({
      title: j.title,
      url: j.jobUrl || `https://jobs.ashbyhq.com/${slug}/${j.id}`,
      company: entry.name,
      location:
        j.location ||
        j.locationName ||
        (j.isRemote || j.workplaceType === 'Remote' ? 'Remote' : ''),
      content: j._content,
    }));
  },
};
