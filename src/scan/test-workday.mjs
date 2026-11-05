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
