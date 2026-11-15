import assert from 'node:assert/strict';
import { legacyUrlKey, urlKey } from './_database.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

assert.equal(urlKey(null), null);
assert.equal(urlKey('https://www.Example.com/Jobs/42/'), 'example.com/jobs/42');
assert.equal(urlKey('https://a.com/p#apply'), 'a.com/p');
assert.equal(urlKey('https://a.com/p?utm_source=x&utm_medium=y&ref=z'), 'a.com/p');
assert.equal(urlKey('https://a.com/p?jr_id=1&source=li&src=x&gh_src=y&lever-source=z'), 'a.com/p');
assert.equal(urlKey('https://a.com/p?l'), 'a.com/p');
assert.equal(urlKey('https://a.com/p?l=en'), 'a.com/p?l=en');
assert.equal(
  urlKey('https://b.greenhouse.io/a/jobs/1?gh_jid=9&gh_src=q'),
  'b.greenhouse.io/a/jobs/1?gh_jid=9',
);
for (const keep of ['jobId=3', 'career_job_req_id=7', 'token=abc', 'for=acme'])
  assert.equal(urlKey(`https://a.com/p?${keep}&utm_campaign=c`), `a.com/p?${keep.toLowerCase()}`);
assert.equal(
  urlKey('https://t.wd3.myworkdayjobs.com/en-US/Site/job/Toronto/Role_JR1?source=x'),
  urlKey('https://t.wd3.myworkdayjobs.com/Site/job/Toronto/Role_JR1'),
);
assert.equal(
  urlKey('https://t.wd3.myworkdayjobs.com/fr-CA/Site/job/a'),
  't.wd3.myworkdayjobs.com/site/job/a',
);
// Hash-routed sites keep a "#/" or "#!/" fragment; other fragments are dropped.
assert.equal(urlKey('https://acme.com/careers#/job/1'), 'acme.com/careers#/job/1');
assert.notEqual(
  urlKey('https://acme.com/careers#/job/1'),
  urlKey('https://acme.com/careers#/job/2'),
);
assert.equal(urlKey('https://acme.com/careers#!/job/1'), 'acme.com/careers#!/job/1');
assert.equal(urlKey('https://acme.com/careers?utm_source=x#/job/1'), 'acme.com/careers#/job/1');
assert.equal(urlKey('https://acme.com/careers#apply'), 'acme.com/careers');
// Locale-like segments on other hosts are left alone.
assert.equal(urlKey('https://a.com/en-US/jobs/1'), 'a.com/en-us/jobs/1');
// The legacy function keeps the old output, used to find rows stored before the change.
assert.equal(legacyUrlKey('https://a.com/p?utm_source=x'), 'a.com/p?utm_source=x');
console.log('urlKey tests passed.');

// findJobByUrl compares urlKey(jobs.url) in JS, so rows stored under an older key are found.
const { findJobByUrl } = await import('./_database.mjs');
const rows = [
  { id: '1', url: 'https://x.example/jobs/9?l', url_key: 'x.example/jobs/9?l' },
  { id: '2', url: 'https://t.wd3.myworkdayjobs.com/en-US/S/job/a', url_key: 'old' },
  { id: '3', url: null, url_key: null },
];
const run = async () => rows;
assert.equal((await findJobByUrl('https://x.example/jobs/9', { query: run }))?.id, '1');
assert.equal(
  (await findJobByUrl('https://t.wd3.myworkdayjobs.com/S/job/a', { query: run }))?.id,
  '2',
);
assert.equal(await findJobByUrl('https://x.example/jobs/9', { query: run, excludeId: '1' }), null);
assert.equal(await findJobByUrl('https://x.example/none', { query: run }), null);
assert.equal(await findJobByUrl('', { query: run }), null);
console.log('findJobByUrl tests passed.');
