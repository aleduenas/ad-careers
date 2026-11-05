import assert from 'node:assert/strict';
import provider, { normalizeWorkableSearchJob } from './providers/workable-search.mjs';
const raw = {
  state: 'published',
  title: 'Data Engineer',
  company: { title: 'Example' },
  url: 'https://jobs.workable.com/view/abc/role',
  locations: ['Toronto, Ontario, Canada'],
  description: 'Build data pipelines. '.repeat(30),
  requirementsSection: '<p>Python and SQL required.</p>',
  benefitsSection: '<p>Health insurance</p>',
};
assert(normalizeWorkableSearchJob(raw).content.includes('Python and SQL required.'));
assert(normalizeWorkableSearchJob(raw).content.includes('Health insurance'));
assert.equal(normalizeWorkableSearchJob({ ...raw, state: 'closed' }), null);
assert.equal(normalizeWorkableSearchJob({ ...raw, url: 'https://evil.example/view/abc' }), null);
assert.equal(normalizeWorkableSearchJob({ ...raw, locations: ['TELECOMMUTE'] }), null);
const calls = [];
const jobs = await provider.fetch(
  { search_terms: ['Data', 'Engineer'] },
  {
    getJson: async url => {
      calls.push(url);
      const p = new URL(url).searchParams;
      return { jobs: [raw], nextPageToken: p.get('pageToken') ? null : 'next' };
    },
  },
);
assert.equal(calls.length, 4);
assert.equal(jobs.length, 1);
assert(calls.every(url => new URL(url).searchParams.get('location') === 'Canada'));
assert.equal(
  (
    await provider.fetch(
      { search_terms: ['Data'] },
      { getJson: async () => ({ jobs: [{ ...raw, locations: ['Remote - USA'] }] }) },
    )
  ).length,
  0,
);
await assert.rejects(
  provider.fetch(
    { search_terms: ['Data'], max_pages_per_query: 1 },
    { getJson: async () => ({ jobs: [raw], nextPageToken: 'next' }) },
  ),
  /page limit/,
);
await assert.rejects(
  provider.fetch(
    { search_terms: ['Data'] },
    { getJson: async () => ({ jobs: [raw], nextPageToken: 'same' }) },
  ),
  /repeated/,
);
await assert.rejects(
  provider.fetch({ search_terms: ['Data'] }, { getJson: async () => ({ error: 'bad' }) }),
  /invalid/,
);
let failures = 0;
await assert.rejects(
  provider.fetch(
    { search_terms: ['Data', 'ML'] },
    {
      getJson: async () => {
        failures++;
        throw Error('HTTP 403');
      },
    },
  ),
  /403/,
);
assert.equal(failures, 1);
console.log(
  'Workable search tests passed: full JD sections, validation, pagination, dedup, geography, caps, HTTP failure.',
);
