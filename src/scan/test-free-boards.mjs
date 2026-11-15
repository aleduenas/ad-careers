import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gate } from './location-gate-core.mjs';
import { remoteLocation, unescapeXml, xmlTag } from './providers/_aggregator.mjs';
import hackernews, { parseComment } from './providers/hackernews.mjs';
import jobicy from './providers/jobicy.mjs';
import remoteok from './providers/remoteok.mjs';
import remotive from './providers/remotive.mjs';
import smartrecruiters, { postingContent } from './providers/smartrecruiters.mjs';
import weworkremotely, { parseRss } from './providers/weworkremotely.mjs';
import workingnomads from './providers/workingnomads.mjs';
import himalayas from './providers/himalayas.mjs';

const quiet = async fn => {
  const log = console.log;
  const lines = [];
  console.log = l => lines.push(l);
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = log;
  }
};
const engineerOnly = { passesFilters: j => /engineer/i.test(j.title) };

// Shared helpers.
assert.equal(remoteLocation(''), 'Remote');
assert.equal(remoteLocation(undefined), 'Remote');
assert.equal(remoteLocation('Canada,  USA'), 'Remote - Canada, USA');
assert.equal(remoteLocation('Remote, Canada'), 'Remote, Canada');
assert.equal(unescapeXml('&lt;p&gt;a &amp; b&lt;/p&gt;'), '<p>a & b</p>');
assert.equal(unescapeXml('<![CDATA[x < y]]>'), 'x < y');
// Numeric entities: decimal and hex decode; one outside the Unicode range does not throw.
assert.equal(unescapeXml('a&#39;b&#x27;c'), "a'b'c");
assert.equal(unescapeXml('x&#99999999;y'), 'x�y');
assert.equal(xmlTag('<a><b> hi </b></a>', 'b'), 'hi');

// Every aggregator is flagged and never auto-detected; smartrecruiters is a direct source.
for (const p of [
  jobicy,
  remoteok,
  remotive,
  workingnomads,
  weworkremotely,
  hackernews,
  himalayas,
]) {
  assert.equal(p.aggregator, true, `${p.id} is an aggregator`);
  assert.equal(p.detect({ careers_url: 'https://example.com' }), null);
}
assert.notEqual(smartrecruiters.aggregator, true);

// jobicy: one request per tag plus the untagged one, filtered, deduplicated.
{
  const urls = [];
  const { result, lines } = await quiet(() =>
    jobicy.fetch(
      { name: 'Jobicy', tags: ['python'], require_location_any: ['Canada'] },
      {
        ...engineerOnly,
        sleep: async () => {},
        getJson: async url => {
          urls.push(url);
          return {
            jobs: [
              {
                url: 'https://jobicy.com/jobs/1',
                jobTitle: 'Data Engineer',
                companyName: 'A',
                jobGeo: 'Canada,  USA',
                jobDescription: '<p>x</p>',
              },
              {
                url: 'https://jobicy.com/jobs/2',
                jobTitle: 'Sales Rep',
                companyName: 'B',
                jobGeo: 'Canada',
                jobDescription: '',
              },
              {
                url: 'https://jobicy.com/jobs/3',
                jobTitle: 'ML Engineer',
                companyName: 'C',
                jobGeo: 'USA',
                jobDescription: '',
              },
            ],
          };
        },
      },
    ),
  );
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('geo=canada') && !urls[0].includes('tag='));
  assert.ok(urls[1].includes('tag=python'));
  assert.deepEqual(
    result.map(j => j.url),
    ['https://jobicy.com/jobs/1'],
  );
  assert.equal(result[0].location, 'Remote - Canada, USA');
  assert.equal(result[0].content, 'x');
  assert.match(
    lines.at(-1),
    /jobicy: 2 requests, 6 postings read, 1 passed filters, 2 dropped by require_location_any/,
  );
}

// remoteok: the legal-notice element is skipped; empty location is a bare Remote.
{
  const { result } = await quiet(() =>
    remoteok.fetch(
      { name: 'ROK' },
      {
        getJson: async () => [
          { legal: 'notice' },
          {
            position: 'Platform Engineer',
            company: 'X',
            location: 'Paris',
            description: '<b>d</b>',
            url: 'https://remoteok.com/1',
          },
          {
            position: 'Engineer',
            company: 'Y',
            location: '',
            description: '',
            url: 'https://remoteok.com/2',
          },
        ],
      },
    ),
  );
  assert.deepEqual(
    result.map(j => j.location),
    ['Remote - Paris', 'Remote'],
  );
  await assert.rejects(
    remoteok.fetch({ name: 'R' }, { getJson: async () => ({}) }),
    /invalid response/,
  );
}

// remotive: one request, and a real run is skipped inside the minimum interval.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'remotive-'));
  try {
    const entry = {
      name: 'Remotive',
      state_file: path.join(dir, 'state.json'),
      min_interval_hours: 6,
    };
    let calls = 0;
    const ctx = (extra = {}) => ({
      now: () => Date.parse('2026-11-14T12:00:00Z'),
      getJson: async () => {
        calls++;
        return {
          jobs: [
            {
              title: 'Engineer',
              company_name: 'Z',
              candidate_required_location: 'Canada',
              description: 'd',
              url: 'https://remotive.com/1',
            },
          ],
        };
      },
      ...extra,
    });
    const dry = await quiet(() => remotive.fetch(entry, ctx({ dryRun: true })));
    assert.equal(dry.result[0].location, 'Remote - Canada');
    assert.equal(calls, 1);
    await quiet(() => remotive.fetch(entry, ctx({ dryRun: true })));
    assert.equal(calls, 2, 'a dry run never records the fetch');
    await quiet(() => remotive.fetch(entry, ctx()));
    assert.equal(calls, 3);
    const skipped = await quiet(() =>
      remotive.fetch(entry, ctx({ now: () => Date.parse('2026-11-14T13:00:00Z') })),
    );
    assert.equal(calls, 3, 'skipped inside the interval');
    assert.deepEqual(skipped.result, []);
    assert.match(skipped.lines[0], /skipped/);
    await quiet(() =>
      remotive.fetch(entry, ctx({ now: () => Date.parse('2026-11-14T19:00:00Z') })),
    );
    assert.equal(calls, 4, 'fetched again after the interval');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// workingnomads.
{
  const { result } = await quiet(() =>
    workingnomads.fetch(
      { name: 'WN' },
      {
        getJson: async () => [
          {
            title: 'Backend Engineer',
            company_name: 'Q',
            location: 'Worldwide',
            description: '<p>desc</p>',
            url: 'https://www.workingnomads.com/job/go/1/',
          },
          { title: '', url: 'x' },
        ],
      },
    ),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].location, 'Remote - Worldwide');
}

// weworkremotely: "Company: Role", region + country, escaped description.
{
  const xml = `<rss><channel><item>
    <title>Acme Co: Senior Data Engineer</title><region>Anywhere in the World</region><country></country>
    <description>&lt;p&gt;Build &amp;amp; run pipelines&lt;/p&gt;</description>
    <link>https://weworkremotely.com/remote-jobs/acme</link></item>
    <item><title>Beta: Support</title><region>USA Only</region><country>United States</country>
    <description>x</description><link>https://weworkremotely.com/remote-jobs/beta</link></item></channel></rss>`;
  const jobs = parseRss(xml);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    [jobs[0].company, jobs[0].title, jobs[0].location],
    ['Acme Co', 'Senior Data Engineer', 'Remote - Anywhere in the World'],
  );
  assert.equal(jobs[0].content, 'Build & run pipelines');
  assert.equal(jobs[1].location, 'Remote - USA Only, United States');
  assert.equal(gate('u', 'Beta', 'Support', null, jobs[1].location).decision, 'FAIL');
  assert.equal(gate('u', 'Acme', 'E', null, jobs[0].location).decision, 'PASS');
  const { result } = await quiet(() =>
    weworkremotely.fetch({ name: 'W' }, { ...engineerOnly, get: async () => xml }),
  );
  assert.equal(result.length, 1);
  await assert.rejects(
    weworkremotely.fetch({ name: 'W' }, { get: async () => 'nope' }),
    /no items/,
  );
}

// hackernews: header parsing, title choice and location.
{
  const comment = (id, text) => ({ id, text });
  const passes = j => /engineer|developer/i.test(j.title);
  const a = parseComment(
    comment(1, 'Acme | Senior Data Engineer | Remote (US/Canada) | Full-time<p>We build things.'),
    passes,
  );
  assert.deepEqual(
    [a.company, a.title, a.location],
    ['Acme', 'Senior Data Engineer', 'Remote (US/Canada), Full-time'],
  );
  assert.equal(a.url, 'https://news.ycombinator.com/item?id=1');
  assert.equal(gate(a.url, a.company, a.title, null, a.location).decision, 'PASS');
  const b = parseComment(
    comment(2, 'Beta | Toronto | Hybrid<p>- Hiring a Backend Developer to join the team<p>Details'),
    passes,
  );
  // A leading list bullet is not part of the title.
  assert.equal(b.title, 'Hiring a Backend Developer to join the team');
  assert.equal(b.location, 'Toronto, Hybrid');
  // Fewer than three header parts is a remark, not a posting.
  assert.equal(
    parseComment(comment(6, 'Thanks! I applied to Acme | Engineer role<p>More text'), passes),
    null,
  );
  assert.equal(parseComment(comment(3, 'Gamma | Sales Manager | NYC<p>Sell things'), passes), null);
  assert.equal(parseComment({ id: 4, text: null }, passes), null);
  assert.equal(parseComment(comment(5, 'Delta | Role | Place'), undefined).title, 'Role');

  const urls = [];
  const { result } = await quiet(() =>
    hackernews.fetch(
      { name: 'HN' },
      {
        ...engineerOnly,
        getJson: async url => {
          urls.push(url);
          if (url.includes('search_by_date'))
            return {
              hits: [
                { objectID: '10', title: 'Ask HN: Who wants to be hired? (November 2026)' },
                { objectID: '11', title: 'Ask HN: Who is hiring? (November 2026)' },
              ],
            };
          return {
            children: [
              comment(21, 'Acme | Data Engineer | Toronto<p>x'),
              comment(22, 'Gamma | Sales | NYC'),
            ],
          };
        },
      },
    ),
  );
  assert.ok(urls[1].endsWith('/items/11'));
  assert.deepEqual(
    result.map(j => j.url),
    ['https://news.ycombinator.com/item?id=21'],
  );
  await assert.rejects(
    hackernews.fetch({ name: 'H' }, { getJson: async () => ({ hits: [] }) }),
    /no "Who is hiring/,
  );
}

// smartrecruiters: detail only for passing, unseen stubs; public URL from the detail; sections.
{
  const detailUrls = [];
  const stubs = [
    {
      id: '1',
      name: 'Data Engineer',
      location: { fullLocation: 'Toronto, ON, Canada', remote: false },
    },
    { id: '2', name: 'Sales Rep', location: { fullLocation: 'Toronto, ON, Canada' } },
    { id: '3', name: 'Seen Engineer', location: { fullLocation: 'Toronto, ON, Canada' } },
    { id: '4', name: 'Fails Engineer', location: { remote: true, fullLocation: 'Canada' } },
  ];
  const { result, lines } = await quiet(() =>
    smartrecruiters.fetch(
      { name: 'Loblaw Digital', company_id: 'LoblawDigital' },
      {
        ...engineerOnly,
        shouldFetchContent: job => !job.title.startsWith('Seen'),
        getJson: async url => {
          if (url.includes('/postings?')) return { totalFound: 4, content: stubs };
          detailUrls.push(url);
          if (url.endsWith('/4')) throw new Error('HTTP 500');
          return {
            postingUrl: 'https://jobs.smartrecruiters.com/LoblawDigital/1-data-engineer',
            jobAd: {
              sections: {
                jobDescription: { title: 'Job Description', text: '<p>Do work</p>' },
                qualifications: { title: 'Qualifications', text: '<ul><li>SQL</li></ul>' },
              },
            },
          };
        },
      },
    ),
  );
  assert.equal(detailUrls.length, 2, 'only passing, unseen stubs are fetched');
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://jobs.smartrecruiters.com/LoblawDigital/1-data-engineer');
  assert.equal(result[0].location, 'Toronto, ON, Canada');
  assert.match(result[0].content, /Job Description\nDo work[\s\S]*Qualifications/);
  assert.ok(lines.some(l => /1 postings skipped this run/.test(l)));
  assert.equal(postingContent({}), null);
  await assert.rejects(smartrecruiters.fetch({ name: 'X' }, {}), /company_id is required/);
}

// A 429 stops an aggregator politely and keeps what was read.
{
  const { result, lines } = await quiet(() =>
    jobicy.fetch(
      { name: 'J', tags: ['a'] },
      {
        sleep: async () => {},
        getJson: async url => {
          if (url.includes('tag=')) throw new Error('HTTP 429 Too Many Requests');
          return {
            jobs: [
              {
                url: 'https://jobicy.com/jobs/9',
                jobTitle: 'Engineer',
                companyName: 'A',
                jobGeo: 'Canada',
                jobDescription: '',
              },
            ],
          };
        },
      },
    ),
  );
  assert.equal(result.length, 1);
  assert.match(lines.at(-1), /stopped early: HTTP 429/);
}
console.log('Free job-board provider tests passed.');
