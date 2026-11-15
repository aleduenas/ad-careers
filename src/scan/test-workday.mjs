import assert from 'node:assert/strict';
import provider from './providers/workday-api.mjs';
const entry = {
  name: 'Fixture',
  workday_tenant: 'fixture',
  workday_host: 'wd3',
  workday_site: 'Jobs',
  workday_search_all: true,
};
const offsets = [];
const jobs = await provider.fetch(entry, {
  postJson: async (_url, body) => {
    assert.equal(body.searchText, '');
    offsets.push(body.offset);
    return {
      total: 21,
      jobPostings: Array.from({ length: body.offset ? 1 : 20 }, (_, i) => ({
        title: 'Data Engineer',
        externalPath: `/job/${body.offset + i}`,
        locationsText: 'Toronto',
      })),
    };
  },
  getJson: async () => ({
    jobPostingInfo: {
      title: 'Data Engineer',
      location: 'Vancouver',
      additionalLocations: ['Remote - Canada', 'Toronto', 'Vancouver'],
      jobDescription: '<p>Full description</p>',
    },
  }),
});
assert.deepEqual(offsets, [0, 20]);
assert.equal(jobs.length, 21);
assert.equal(jobs[0].location, 'Vancouver; Remote - Canada; Toronto');
await assert.rejects(
  provider.fetch(entry, {
    postJson: async (_url, body) => ({
      total: 201,
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        externalPath: `/job/${body.offset + i}`,
      })),
    }),
  }),
  /incomplete results/,
);
console.log('Workday pagination and multiple-location tests passed.');

// D108-3: pre-check, stable URL, retry/omit, "N Locations".
{
  const base = 'https://fixture.wd3.myworkdayjobs.com';
  const stubs = [
    { title: 'Data Engineer', externalPath: '/job/a', locationsText: '2 Locations' },
    { title: 'Sales Rep', externalPath: '/job/b', locationsText: 'Toronto' },
    { title: 'ML Engineer', externalPath: '/job/c', locationsText: 'Toronto' },
    { title: 'AI Engineer', externalPath: '/job/d', locationsText: 'Toronto' },
  ];
  const calls = {};
  const waits = [];
  const out = [];
  const log = console.log;
  console.log = line => out.push(line);
  const result = await provider.fetch(entry, {
    sleep: async ms => waits.push(ms),
    shouldFetchContent: job => {
      if (job.title === 'Data Engineer') assert.equal(job.location, '');
      return job.title !== 'Sales Rep';
    },
    postJson: async () => ({ total: 4, jobPostings: stubs }),
    getJson: async url => {
      calls[url] = (calls[url] || 0) + 1;
      if (url.endsWith('/job/a'))
        return {
          jobPostingInfo: {
            title: 'Data Engineer',
            location: '2 Locations',
            externalUrl: `${base}/en-US/Jobs/job/a`,
            jobDescription: '<p>x</p>',
          },
        };
      if (url.endsWith('/job/c') && calls[url] < 3) throw new Error('HTTP 429 Too Many Requests');
      if (url.endsWith('/job/c'))
        return { jobPostingInfo: { jobDescription: '<p>ok</p>', location: 'Toronto' } };
      throw new Error('Request timed out after 20000ms');
    },
  });
  console.log = log;
  assert.equal(calls[`${base}/wday/cxs/fixture/Jobs/job/b`], undefined, 'pre-check skips detail');
  assert.equal(calls[`${base}/wday/cxs/fixture/Jobs/job/c`], 3, 'two retries then success');
  assert.deepEqual(
    [...waits].sort((a, b) => a - b),
    [1500, 1500, 4000, 4000],
  );
  assert.equal(result.length, 3, 'persistent timeout is omitted, not stubbed');
  assert.deepEqual(
    result.map(r => r.url),
    ['a', 'b', 'c'].map(k => `${base}/Jobs/job/${k}`),
  );
  assert.equal(result[0].location, '', 'N Locations after detail becomes unknown');
  assert.equal(result[1].content, null);
  assert.equal(result[2].content, 'ok');
  assert.ok(out.some(l => /workday: Fixture: 1 postings skipped this run/.test(l)));
}
console.log('Workday detail pre-check and retry tests passed.');
