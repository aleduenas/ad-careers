import assert from 'node:assert/strict';
import provider from './providers/breezy.mjs';

assert.ok(provider.detect({ breezy_board: 'zero-hash' }));
assert.ok(provider.detect({ careers_url: 'https://zero-hash.breezy.hr/' }));
assert.ok(!provider.detect({ careers_url: 'https://example.com/careers' }));

const page = `<html><script type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting',
  description: '<p>Build things.</p>',
})}</script></html>`;
const fetched = [];
const ctx = {
  getJson: async url => {
    assert.equal(url, 'https://zero-hash.breezy.hr/json');
    return [
      {
        name: 'Data Engineer',
        url: 'https://zero-hash.breezy.hr/p/1-data-engineer',
        location: { name: 'Remote - Canada' },
      },
      {
        name: 'Sales Lead',
        url: 'https://zero-hash.breezy.hr/p/2-sales-lead',
        location: { name: 'New York, NY' },
      },
      { name: 'Broken', url: 'https://zero-hash.breezy.hr/p/3-broken', location: {} },
    ];
  },
  get: async url => {
    fetched.push(url);
    if (url.endsWith('3-broken')) throw new Error('HTTP 500');
    return page;
  },
  shouldFetchContent: job => job.title !== 'Sales Lead',
};
const jobs = await provider.fetch({ name: 'Zero Hash', breezy_board: 'zero-hash' }, ctx);
assert.equal(jobs.length, 3);
assert.equal(jobs[0].location, 'Remote - Canada');
assert.equal(jobs[0].content, 'Build things.');
assert.equal(jobs[1].content, null);
assert.ok(!fetched.some(u => u.includes('sales-lead')), 'filtered postings are not fetched');
assert.equal(jobs[2].content, null);
assert.equal(jobs[2].location, '');

await assert.rejects(
  provider.fetch({ name: 'X', careers_url: 'https://example.com' }, ctx),
  /cannot derive/,
);
await assert.rejects(
  provider.fetch({ name: 'X', breezy_board: 'x' }, { getJson: async () => ({}) }),
  /invalid list/,
);
console.log('Breezy provider tests passed.');
