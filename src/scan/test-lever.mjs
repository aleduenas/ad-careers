import assert from 'node:assert/strict';
import provider from './providers/lever-api.mjs';
const entry = { name: 'Example', careers_url: 'https://jobs.lever.co/example' };
const job = i => ({
  id: String(i),
  text: 'Engineer',
  hostedUrl: 'https://jobs.lever.co/example/' + i,
  descriptionPlain: 'Main description',
  lists: [{ text: 'Requirements', content: '<p>Python and SQL</p>' }],
  additionalPlain: 'Benefits',
});
const skips = [];
const jobs = await provider.fetch(entry, {
  getJson: async raw => {
    const skip = Number(new URL(raw).searchParams.get('skip'));
    skips.push(skip);
    return Array.from({ length: skip ? 1 : 250 }, (_, i) => job(skip + i));
  },
});
assert.deepEqual(skips, [0, 250]);
assert.equal(jobs.length, 251);
assert.ok(jobs[0].content.includes('Python and SQL'));
assert.ok(jobs[0].content.includes('Benefits'));
await assert.rejects(
  provider.fetch(entry, { getJson: async () => Array.from({ length: 250 }, (_, i) => job(i)) }),
  /repeated/,
);
await assert.rejects(
  provider.fetch(
    { ...entry, max_pages: 1 },
    { getJson: async () => Array.from({ length: 250 }, (_, i) => job(i)) },
  ),
  /incomplete/,
);
console.log('Lever tests passed: complete pagination, list sections, repeated-page and cap errors');
