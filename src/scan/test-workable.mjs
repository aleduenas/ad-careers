import assert from 'node:assert/strict';
import test from 'node:test';
import workable, { parseWorkableCountries } from './providers/workable.mjs';

const directory = `# Example — Open Positions
> This company has 51 open positions. Use the search endpoint to filter results.
## Locations
- United Kingdom: England, London
- Canada: Ontario, Toronto
- Canada: British Columbia, Vancouver
## Workplace Types
- hybrid
`;
const row = (id, title = 'Security Operations Analyst') =>
  `| ${title} | Security | Toronto, Canada (Hybrid) | Full-time | — | 2026-09-15 | [View](https://apply.workable.com/example/jobs/view/${id}.md) |`;
const entry = { name: 'Example', workable_board: 'example' };

test('directory countries are bounded to Locations and deduplicated', () => {
  assert.deepEqual(parseWorkableCountries(directory), ['United Kingdom', 'Canada']);
});

test('directory expands country feeds, deduplicates jobs, and fetches only eligible details', async () => {
  const calls = [];
  const jobs = await workable.fetch(entry, {
    get: async raw => {
      calls.push(raw);
      const url = new URL(raw);
      if (url.pathname.endsWith('/MATCH.md')) return 'Full original job description';
      if (url.searchParams.has('location[0][country]'))
        return `${row('MATCH')}\n${row('OTHER', 'Director')}`;
      return directory;
    },
    shouldFetchContent: job => job.title !== 'Director',
  });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].content, 'Full original job description');
  assert.equal(jobs[1].content, undefined);
  assert.equal(calls.length, 4);
  assert.equal(
    jobs.every(job => job.contentRequired),
    true,
  );
});

test('ordinary table feeds still work without additional requests in probe mode', async () => {
  let requests = 0;
  const jobs = await workable.fetch(entry, {
    probe: true,
    get: async () => {
      requests++;
      return row('MATCH');
    },
  });
  assert.equal(jobs.length, 1);
  assert.equal(requests, 1);
});

test('unresolved directory throws instead of reporting an empty successful scan', async () => {
  await assert.rejects(
    workable.fetch(entry, { get: async () => directory }),
    /did not resolve directory/,
  );
  await assert.rejects(
    workable.fetch(entry, { get: async () => 'Use the search endpoint to filter results' }),
    /cannot enumerate/,
  );
});
