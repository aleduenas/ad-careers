import assert from 'node:assert/strict';
import provider, { himalayasLocation } from './providers/himalayas.mjs';
import { gate } from './location-gate-core.mjs';

const usOnly = ['United States'];
const withCanada = ['Albania', 'Canada', 'Germany', 'United States', 'United Kingdom'];
assert.equal(himalayasLocation([], 'CA'), 'Remote - Worldwide');
assert.equal(himalayasLocation(withCanada, 'CA'), 'Remote - Canada');
assert.equal(himalayasLocation(usOnly, 'CA'), 'Remote - United States');

const decide = list =>
  gate('https://x.example/job', 'X', 'Data Engineer', null, himalayasLocation(list, 'CA')).decision;
assert.equal(decide([]), 'PASS', 'worldwide passes the gate');
assert.equal(decide(withCanada), 'PASS', 'a list that includes Canada passes the gate');
assert.equal(decide(usOnly), 'FAIL', 'a US-only list fails the gate');

const job = (title, guid, restrictions, extra = {}) => ({
  title,
  companyName: 'Acme',
  locationRestrictions: restrictions,
  applicationLink: `https://himalayas.app/companies/acme/jobs/${guid}?utm_source=api`,
  guid: `https://himalayas.app/companies/acme/jobs/${guid}`,
  description: '<p>Full description</p>',
  ...extra,
});

const urls = [];
const waits = [];
const ctx = {
  sleep: async ms => waits.push(ms),
  passesFilters: j => !/sales/i.test(j.title),
  getJson: async url => {
    urls.push(url);
    const u = new URL(url);
    assert.equal(u.searchParams.get('country'), 'CA');
    assert.equal(u.searchParams.get('sort'), 'recent');
    const term = u.searchParams.get('q');
    const page = Number(u.searchParams.get('page'));
    if (term === 'data engineer' && page === 1)
      return { jobs: [job('Data Engineer', 'a', []), job('Sales Data Lead', 'b', ['Canada'])] };
    if (term === 'data engineer' && page === 2) return { jobs: [] };
    if (term === 'ml' && page > 1) return { jobs: [] };
    if (term === 'ml')
      return { jobs: [job('Data Engineer', 'a', []), job('ML Engineer', 'c', ['United States'])] };
    throw new Error('unexpected');
  },
};
const jobs = await provider.fetch(
  { name: 'Himalayas', search_terms: ['data engineer', 'ml'], max_pages_per_query: 3 },
  ctx,
);
assert.deepEqual(
  jobs.map(j => j.title),
  ['Data Engineer', 'ML Engineer'],
  'filtered by passesFilters and deduplicated across terms',
);
assert.equal(jobs[0].location, 'Remote - Worldwide');
assert.equal(jobs[0].company, 'Acme');
assert.match(jobs[0].url, /^https:\/\/himalayas\.app\/companies\/acme\/jobs\/a/);
assert.equal(jobs[0].content, 'Full description');
assert.equal(urls.length, 4, 'an empty page ends the term');
assert.deepEqual(waits, [500, 500, 500]);

// Page cap, missing terms, and a 429 that keeps what was already read.
const capped = [];
await provider.fetch(
  { name: 'H', search_terms: ['x'], max_pages_per_query: 2 },
  {
    sleep: async () => {},
    getJson: async url => {
      capped.push(url);
      return { jobs: [job('T' + capped.length, 'p' + capped.length, [])] };
    },
  },
);
assert.equal(capped.length, 2);
await assert.rejects(provider.fetch({ name: 'H' }, ctx), /search_terms is required/);
const partial = await provider.fetch(
  { name: 'H', search_terms: ['a', 'b'] },
  {
    sleep: async () => {},
    getJson: async url => {
      if (url.includes('q=b')) throw new Error('HTTP 429 Too Many Requests');
      return { jobs: [job('Kept', 'k', [])] };
    },
  },
);
assert.equal(partial.length, 1);
console.log('Himalayas provider tests passed.');
