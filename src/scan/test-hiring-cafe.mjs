#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  extractDescriptionFromHtml,
  extractEmbeddedDescription,
  fetchCanonicalJobDescription,
  mapWithHostLimits,
} from './providers/_canonical-jd.mjs';
import { htmlToText } from './providers/_http.mjs';

const fullText =
  `About the role ${'Build reliable data platforms and production services. '.repeat(12)}`.trim();
assert.equal(
  extractEmbeddedDescription({
    v5_processed_job_data: {
      description: fullText,
      job_description: fullText,
      requirements_summary: fullText,
    },
  }),
  null,
  'AI-processed fields cannot serve as original JD text',
);

assert.equal(
  htmlToText('<p>AI&#xa0;platform â€” candidateâ€™s work</p>'),
  "AI platform — candidate's work",
  'rendered ATS text should decode numeric entities and repair UTF-8 mojibake',
);

assert.equal(
  extractEmbeddedDescription({
    job_information: { description: `<p>${fullText}</p>` },
    v5_processed_job_data: { requirements_summary: 'AI summary must not be used' },
  }),
  fullText,
);

const jsonLd = `<html><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Data Engineer',
  description: `<div>${fullText}</div>`,
})}</script></html>`;
assert.equal(extractDescriptionFromHtml(jsonLd), fullText);

const microdata = `<div itemscope itemtype="http://schema.org/JobPosting"><span itemprop="description"><span class="jobdescription"><p>${fullText}</p></span></span></div>`;
assert.equal(extractDescriptionFromHtml(microdata), fullText);

let requestedUrl = '';
const greenhouse = await fetchCanonicalJobDescription(
  {
    apply_url: 'https://job-boards.greenhouse.io/example/jobs/12345',
    v5_processed_job_data: { requirements_summary: 'AI summary must not be used' },
  },
  {
    fetchImpl: async url => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ content: `<p>${fullText}</p>` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  },
);
assert.match(requestedUrl, /boards-api\.greenhouse\.io\/v1\/boards\/example\/jobs\/12345/);
assert.equal(greenhouse?.text, fullText);
assert.equal(greenhouse?.method, 'greenhouse');

const missing = await fetchCanonicalJobDescription(
  {
    apply_url: 'https://example.com/jobs/123',
    v5_processed_job_data: { requirements_summary: fullText },
  },
  {
    fetchImpl: async () => new Response('<html><title>Job</title></html>', { status: 200 }),
  },
);
assert.equal(missing, null, 'AI requirements_summary must never substitute for a full JD');

const order = [];
const limited = await mapWithHostLimits(
  [
    { apply_url: 'https://a.example/1' },
    { apply_url: 'https://a.example/2' },
    { apply_url: 'https://b.example/3' },
  ],
  async (_item, index) => {
    order.push(index);
    await new Promise(resolve => setTimeout(resolve, 5));
    return index;
  },
  { concurrency: 2, perHost: 1 },
);
assert.deepEqual(limited, [0, 1, 2]);
assert.equal(order[0], 0);
assert.equal(order[1], 2, 'per-host limit should let another ATS run instead of flooding one host');

const liveUrlIndex = process.argv.indexOf('--live-url');
if (liveUrlIndex >= 0) {
  const liveUrl = process.argv[liveUrlIndex + 1];
  assert.ok(liveUrl, '--live-url requires a URL');
  const live = await fetchCanonicalJobDescription({ apply_url: liveUrl });
  assert.ok(live?.text, `no full JD found at ${liveUrl}`);
  console.log(`live full JD via ${live.method}: ${live.text.length} characters`);
}

console.log('hiring.cafe provider tests passed');
