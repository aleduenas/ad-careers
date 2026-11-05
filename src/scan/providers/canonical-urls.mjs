/**
 * canonical-urls.mjs — zero-token ingestion for known employer job URLs.
 *
 * Use this when an aggregator reveals a role but its discovery endpoint is
 * unavailable. The configured URL must be the employer/ATS posting, never an
 * aggregator detail page.
 *
 * portals.yml entry:
 *   - name: Example Corp
 *     provider: canonical-urls
 *     job_urls:
 *       - url: https://careers.example.com/jobs/123
 *         title: Security Engineer
 *         location: Toronto, Ontario, Canada
 *     enabled: true
 */

import { chromium } from 'playwright';
import {
  fetchCanonicalJobDescription,
  fetchRenderedCanonicalJobDescription,
  mapWithHostLimits,
} from './_canonical-jd.mjs';

function normalize(entry, item) {
  if (typeof item === 'string') return { url: item, title: '', location: '', company: entry.name };
  return {
    url: item?.url || '',
    title: item?.title || '',
    location: item?.location || '',
    company: item?.company || entry.name,
  };
}

export default {
  id: 'canonical-urls',

  detect() {
    return null;
  },

  async fetch(entry, scanCtx) {
    const jobs = (entry.job_urls || []).map(item => normalize(entry, item));
    const valid = jobs.filter(job => {
      if (job.url && job.title) return true;
      console.error(`canonical-urls: each job requires url + title for "${entry.name}"`);
      return false;
    });

    const needsContent = valid.filter(
      job => typeof scanCtx?.shouldFetchContent !== 'function' || scanCtx.shouldFetchContent(job),
    );
    const resolved = await mapWithHostLimits(
      needsContent,
      job => fetchCanonicalJobDescription({ apply_url: job.url }),
      { concurrency: entry.jd_concurrency || 6, perHost: entry.jd_concurrency_per_host || 2 },
    );

    const unresolved = resolved.flatMap((full, index) => (full ? [] : [index]));
    if (unresolved.length) {
      const browser = await chromium.launch({ headless: true });
      try {
        const rendered = await mapWithHostLimits(
          unresolved.map(index => needsContent[index]),
          job => fetchRenderedCanonicalJobDescription(job.url, browser),
          { concurrency: 3, perHost: 1 },
        );
        for (let index = 0; index < unresolved.length; index++) {
          resolved[unresolved[index]] = rendered[index];
        }
      } finally {
        await browser.close();
      }
    }

    const details = new Map(needsContent.map((job, index) => [job.url, resolved[index]]));
    return valid.map(job => ({
      ...job,
      content: details.get(job.url)?.text || null,
      contentRequired: true,
    }));
  },
};
