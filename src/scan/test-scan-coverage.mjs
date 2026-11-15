#!/usr/bin/env node

import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

import {
  buildLocationFilter,
  buildTitleFilter,
  directFirstGate,
  companyRoleKey,
  laneConcurrency,
  laneKey,
  loadProviders,
  processJobs,
  runLanes,
} from './scan.mjs';
import ashbyProvider from './providers/ashby-api.mjs';
import greenhouseProvider from './providers/greenhouse-api.mjs';
import pinpointProvider, { parsePinpointResponse } from './providers/pinpoint.mjs';
import successFactorsProvider, {
  inferSuccessFactorsLocation,
  parseSuccessFactorsTiles,
} from './providers/successfactors.mjs';
import workableProvider, { parseWorkableMarkdown } from './providers/workable.mjs';
import { urlKey } from '../lib/_database.mjs';
import { classifyPortal, verifyPortalEntries } from '../helpers/verify-portals.mjs';

import { root as ROOT } from '../lib/root.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

async function fixtureTests() {
  const titleRules = { positive: ['Data Engineer'], negative: ['Staff', 'Lead', 'Manager'] };
  const companyTitles = buildTitleFilter(titleRules, ['Software Developer']);
  assert(companyTitles('Senior Software Developer'));
  assert(companyTitles('Data Engineer'));
  assert(!companyTitles('Lead, Software Developer'));
  assert(!companyTitles('Staff Software Developer'));
  assert(!companyTitles('Sales Associate'));
  assert(!buildTitleFilter(titleRules)('Software Developer'));

  // D108-1: short positive keywords match whole words only; longer ones stay substrings.
  const shortKeys = buildTitleFilter({ positive: ['ETL', 'AI', 'Data Engineer'] });
  assert(!shortKeys('Settlement Analyst'));
  assert(shortKeys('ETL Developer'));
  assert(shortKeys('Senior AI/ML Engineer'));
  assert(!shortKeys('Maintenance Technician'));
  assert(shortKeys('Senior Data Engineer'));
  assert(buildTitleFilter({ positive: ['Data Engineer'] }, ['GRC'])('GRC Analyst'));
  assert(!buildTitleFilter({ positive: ['Data Engineer'] }, ['GRC'])('Aggregrc'));

  // D108-4b: company-role dedup normaliser.
  assert.equal(
    companyRoleKey('Acme Corp.', 'Data Engineer (5440)'),
    companyRoleKey('ACME', 'data  engineer'),
  );
  assert.equal(companyRoleKey('Foo, Inc.', 'ML Engineer [ATH 5531]'), 'foo::ml engineer');
  assert.equal(companyRoleKey('Foo Ltd', 'Sr. Engineer (Remote)'), 'foo::sr engineer remote');
  assert.notEqual(companyRoleKey('TD', 'Analyst'), companyRoleKey('TD Bank', 'Analyst'));

  // Leading word boundary for every positive keyword; trailing only for short ones.
  const itRisk = buildTitleFilter({ positive: ['IT Risk'] });
  assert(itRisk('Senior IT Risk Analyst'));
  assert(itRisk('IT Risk Analyst'));
  assert(!itRisk('Credit Risk Analyst'));
  const sec = buildTitleFilter({ positive: ['Security'] });
  assert(sec('Security Engineer'));
  assert(sec('Application Security Developer'));
  assert(!sec('Cybersecurity Engineer'));
  assert(buildTitleFilter({ positive: ['Data Engineer'] })('Data Engineers'));
  assert(buildTitleFilter({ positive: ['.NET'] })('Senior .NET Developer'));

  // Only requisition tags are stripped from titles.
  assert.equal(companyRoleKey('A', 'Analyst (5440)'), companyRoleKey('A', 'Analyst'));
  assert.equal(companyRoleKey('A', 'Analyst (ATH 5531)'), companyRoleKey('A', 'Analyst'));
  assert.notEqual(
    companyRoleKey('A', 'Engineer (Level 2)'),
    companyRoleKey('A', 'Engineer (Level 3)'),
  );
  assert.notEqual(
    companyRoleKey('A', 'Analyst (6 months)'),
    companyRoleKey('A', 'Analyst (12 months)'),
  );

  const workable = parseWorkableMarkdown(
    '| Title | Department | Location | Type | Salary | Posted | Details |\n' +
      '| Data Engineer | Data | Toronto | Full time | — | Today | [View](https://apply.workable.com/acme/j/ABC/jobs/view/data-engineer.md) |\n' +
      '| Evil | Data | Toronto | Full time | — | Today | [View](https://evil.example/job.md) |',
    'Acme',
  );
  assert.equal(workable.length, 1);
  assert.equal(workable[0].title, 'Data Engineer');
  assert(!workable[0].url.endsWith('.md'));

  const pinpoint = parsePinpointResponse(
    {
      data: [
        {
          title: 'ML Engineer',
          url: 'https://acme.pinpointhq.com/postings/123',
          location: { city: 'Toronto', province: 'Ontario' },
        },
      ],
    },
    'Acme',
  );
  assert.deepEqual(pinpoint[0].location, 'Toronto, Ontario');

  const sf = parseSuccessFactorsTiles(
    '<li class="job-tile job-id-123"><a class="jobTitle-link" data-x="1">Security Engineer</a><div data-url="/job/Toronto-Security-Engineer/123/"></div><div id="123-section-city-value">Toronto</div></li>',
    'https://jobs.example.com',
  );
  assert.equal(sf.length, 1);
  assert.equal(sf[0].url, 'https://jobs.example.com/job/Toronto-Security-Engineer/123/');
  assert.equal(sf[0].location, 'Toronto');
  assert.equal(
    inferSuccessFactorsLocation(
      '/job/Saint-John-Senior-Data-Engineer-NB/456/',
      'Senior Data Engineer',
    ),
    'Saint John',
  );

  const workableCalls = [];
  const workableJobs = await workableProvider.fetch(
    { name: 'Acme', workable_board: 'acme' },
    {
      probe: false,
      shouldFetchContent: () => true,
      get: async url => {
        workableCalls.push(url);
        if (url.endsWith('/jobs.md')) {
          return (
            '| Title | Department | Location | Type | Salary | Posted | Details |\n' +
            '| Data Engineer | Data | Toronto | Full time | — | Today | [View](https://apply.workable.com/acme/j/ABC/jobs/view/data-engineer.md) |'
          );
        }
        return `# Data Engineer\n\n${'Build reliable production data systems. '.repeat(12)}`;
      },
    },
  );
  assert.deepEqual(workableCalls, [
    'https://apply.workable.com/acme/jobs.md',
    'https://apply.workable.com/acme/j/ABC/jobs/view/data-engineer.md',
  ]);
  assert(workableJobs[0].content.length >= 300);

  const pinpointCalls = [];
  assert.equal(
    pinpointProvider.detect({ api: 'https://jobs.example.com' }),
    null,
    'unrelated API hosts must not be claimed by Pinpoint',
  );
  const pinpointJobs = await pinpointProvider.fetch(
    {
      name: 'Acme',
      careers_url: 'https://careers.acme.example',
      api: 'https://acme.pinpointhq.com',
    },
    {
      probe: false,
      shouldFetchContent: () => true,
      getJson: async url => {
        pinpointCalls.push(url);
        return {
          data: [
            {
              title: 'ML Engineer',
              url: 'https://acme.pinpointhq.com/postings/123',
              location: { city: 'Toronto' },
              description: 'Build production ML systems. '.repeat(14),
            },
          ],
        };
      },
    },
  );
  assert.deepEqual(pinpointCalls, ['https://acme.pinpointhq.com/postings.json']);
  assert(pinpointJobs[0].content.length >= 300);

  const sfCalls = [];
  const sfJobs = await successFactorsProvider.fetch(
    { name: 'Acme', api: 'https://jobs.example.com' },
    {
      probe: false,
      shouldFetchContent: () => false,
      get: async url => {
        sfCalls.push(url);
        return url.endsWith('startrow=0')
          ? '<li class="job-tile job-id-123" data-url="/job/Toronto-Data-Engineer/123/"><a class="jobTitle-link">Data Engineer</a></li>'
          : '';
      },
    },
  );
  assert.deepEqual(sfCalls, [
    'https://jobs.example.com/tile-search-results/?startrow=0',
    'https://jobs.example.com/tile-search-results/?startrow=1',
  ]);
  assert.equal(sfJobs[0].location, 'Toronto');

  const ashbyCalls = [];
  const ashbyJobs = await ashbyProvider.fetch(
    { name: 'Acme', careers_url: 'https://acme.example/careers', ashby_board: 'acme' },
    {
      getJson: async url => {
        ashbyCalls.push(url);
        if (url.includes('job-posting?')) return { description: 'Detailed Ashby JD. '.repeat(20) };
        return {
          jobs: [
            {
              id: 'abc',
              title: 'Data Engineer',
              jobUrl: 'https://jobs.ashbyhq.com/acme/abc',
              location: 'Toronto',
            },
          ],
        };
      },
    },
  );
  assert.equal(ashbyCalls[0], 'https://api.ashbyhq.com/posting-api/job-board/acme');
  assert(ashbyCalls[1].includes('jobPostingId=abc'));
  assert(ashbyJobs[0].content.length >= 300);

  const greenhouseCalls = [];
  const greenhouseJobs = await greenhouseProvider.fetch(
    { name: 'Acme', careers_url: 'https://acme.example/careers', greenhouse_board: 'acme' },
    {
      getJson: async url => {
        greenhouseCalls.push(url);
        return {
          jobs: [
            {
              title: 'Security Engineer',
              absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
              location: { name: 'Toronto' },
              content: '<p>' + 'Detailed Greenhouse JD. '.repeat(16) + '</p>',
            },
          ],
        };
      },
    },
  );
  assert.deepEqual(greenhouseCalls, [
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
  ]);
  assert(greenhouseJobs[0].content.length >= 300);
}

async function verifierTests() {
  const providers = new Map([
    [
      'fixture',
      {
        id: 'fixture',
        detect: () => null,
        fetch: async (_entry, ctx) => [await ctx.getJson('https://fixture.example/jobs')],
      },
    ],
  ]);
  const httpCtx = {
    get: async () => '<html>careers</html>',
    getJson: async () => ({ title: 'Data Engineer', url: 'https://fixture.example/jobs/1' }),
    postJson: async () => ({}),
  };
  const results = await verifyPortalEntries(
    [
      { name: 'Structured', provider: 'fixture', enabled: true },
      {
        name: 'Rich',
        careers_url: 'https://rich.example/jobs',
        scan_class: 'rich-only',
        enabled: true,
      },
      { name: 'Retired', scan_class: 'retired', enabled: false },
      { name: 'Unknown', enabled: true },
    ],
    { providers, httpCtx, includeDisabled: true },
  );
  assert.deepEqual(
    results.map(row => row.status),
    ['ok', 'rich-only', 'retired', 'unclassified'],
  );

  const config = yaml.load(readFileSync(path.join(ROOT, 'config/portals.yml'), 'utf-8'));
  const realProviders = await loadProviders();
  const titleFilter = buildTitleFilter(config.title_filter);
  for (const title of [
    'Director, Data Engineering',
    'Vice President, Enterprise AI Platforms',
    'Head of Vulnerability Management',
    'Senior Manager, Data Engineering',
    'Chief Information Security Officer',
  ])
    assert.equal(titleFilter(title), false, `seniority gate should reject: ${title}`);
  assert.equal(titleFilter('Senior Security Engineer'), true);
  assert.equal(titleFilter('Senior Security Engineer, Vulnerability Management'), true);
  assert(config.tracked_companies.length > 0, 'at least one portal is configured');
  assert.equal(
    config.tracked_companies.filter(
      entry => classifyPortal(entry, realProviders).classification === 'unclassified',
    ).length,
    0,
  );
}

async function directFirstTests() {
  const filters = { titleFilter: () => true, locationFilter: () => true };
  const body = 'Full job description line. '.repeat(20);
  const job = (url, extra = {}) => ({
    title: 'Data Engineer (5440)',
    company: 'Acme Inc.',
    url,
    location: 'Toronto, Ontario',
    content: body,
    ...extra,
  });
  const direct = { id: 'greenhouse' };
  const aggregator = { id: 'remoteok', aggregator: true };
  const freshRun = (roles = []) => ({
    seenUrls: new Set(),
    seenCompanyRoles: new Set(roles),
    dryRun: true,
    date: '2026-11-14',
    counts: { filteredTitle: 0, filteredLocation: 0, dupes: 0, gateFailed: 0, missingContent: 0 },
    missingFullJd: [],
    newOffers: [],
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Either lane may finish fetching first; the direct posting still wins.
  for (const [directDelay, aggregatorDelay] of [
    [40, 0],
    [0, 40],
  ]) {
    const run = freshRun();
    const gateway = directFirstGate([direct, aggregator]);
    const task = (provider, delay, jobs) => async () => {
      try {
        await sleep(delay);
        await gateway.waitForDirect(provider);
        await processJobs({ provider, jobs, ...filters, run });
      } finally {
        gateway.finish(provider);
      }
    };
    await runLanes([
      {
        provider: aggregator,
        entry: { name: 'Remote OK' },
        task: task(aggregator, aggregatorDelay, [
          job('https://remoteok.com/remote-jobs/1', { title: 'Data Engineer', company: 'ACME' }),
        ]),
      },
      {
        provider: direct,
        entry: { name: 'Acme' },
        task: task(direct, directDelay, [job('https://boards.greenhouse.io/acme/jobs/1')]),
      },
    ]);
    assert.equal(run.newOffers.length, 1, 'one new job for the same company and role');
    assert.equal(run.newOffers[0].url, 'https://boards.greenhouse.io/acme/jobs/1');
    assert.equal(run.newOffers[0].source, 'greenhouse-api');
    assert.equal(run.counts.dupes, 1);
  }

  // A role already in the database (jobs or scan_history) yields no new job.
  const known = freshRun([companyRoleKey('Acme', 'Data Engineer')]);
  await processJobs({
    provider: aggregator,
    jobs: [job('https://remoteok.com/remote-jobs/2')],
    ...filters,
    run: known,
  });
  assert.equal(known.newOffers.length, 0);
  assert.equal(known.counts.dupes, 1);

  // Known limits: a different company name or role wording is a different key.
  assert.notEqual(
    companyRoleKey('Loblaw', 'Data Engineer'),
    companyRoleKey('Loblaw Digital', 'Data Engineer'),
  );
  assert.notEqual(
    companyRoleKey('Acme', 'Data Engineer (Remote)'),
    companyRoleKey('Acme', 'Data Engineer'),
  );

  // No direct provider at all: aggregators are not left waiting.
  await directFirstGate([aggregator]).waitForDirect(aggregator);
}

async function badPostingTests() {
  // One malformed posting must not throw out of the filters.
  const title = buildTitleFilter({ positive: ['Engineer'] });
  for (const bad of [undefined, null, 42, {}]) assert.equal(title(bad), false);
  const location = buildLocationFilter({ allow: ['toronto'] });
  for (const bad of [undefined, null, 42, {}, '']) assert.equal(location(bad), true);
  assert.equal(location('Paris'), false);
  assert.doesNotThrow(() => urlKey(undefined) ?? urlKey(42));
}

async function laneTests() {
  assert.equal(laneKey({ id: 'greenhouse' }, { name: 'A' }), 'greenhouse');
  assert.equal(
    laneKey({ id: 'workday' }, { name: 'A', workday_tenant: 'acme', workday_host: 'wd3' }),
    'workday:acme.wd3',
  );
  assert.equal(
    laneKey({ id: 'pinpoint' }, { name: 'A', careers_url: 'https://Foo.pinpointhq.com/x' }),
    'pinpoint:foo.pinpointhq.com',
  );
  assert.equal(laneKey({ id: 'x', lane: () => 'custom' }, { name: 'A' }), 'custom');
  assert.equal(laneConcurrency({ id: 'lever' }), 4);
  assert.equal(laneConcurrency({ id: 'workday' }), 1);
  assert.equal(laneConcurrency({ id: 'workday', laneConcurrency: 3 }), 3);

  // Fake services record in-flight counts and overlap.
  const tracker = { inflight: {}, max: {}, total: 0, maxTotal: 0, done: [] };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const item = (providerId, name, { fail = false, provider = {} } = {}) => ({
    provider: { id: providerId, ...provider },
    entry: { name },
    task: async () => {
      const lane = laneKey({ id: providerId, ...provider }, { name });
      tracker.inflight[lane] = (tracker.inflight[lane] || 0) + 1;
      tracker.max[lane] = Math.max(tracker.max[lane] || 0, tracker.inflight[lane]);
      tracker.total++;
      tracker.maxTotal = Math.max(tracker.maxTotal, tracker.total);
      try {
        await sleep(25);
        // Tasks isolate their own errors, as scan.mjs company tasks do.
        if (fail) throw new Error('boom');
        tracker.done.push(name);
      } catch {
        tracker.done.push(name + ':failed');
      } finally {
        tracker.inflight[lane]--;
        tracker.total--;
      }
    },
  });
  const lanes = await runLanes([
    item('slow', 's1'),
    item('slow', 's2', { fail: true }),
    item('slow', 's3'),
    item('fast', 'f1', { provider: { laneConcurrency: 2 } }),
    item('fast', 'f2', { provider: { laneConcurrency: 2 } }),
    item('fast', 'f3', { provider: { laneConcurrency: 2 } }),
  ]);
  assert.equal(lanes, 2);
  assert.equal(tracker.max.slow, 1, 'a concurrency-1 lane never has two companies in flight');
  assert.equal(tracker.max.fast, 2);
  assert(tracker.maxTotal >= 3, 'lanes overlap in time');
  assert.equal(tracker.done.length, 6, 'a failing company does not stop its lane or others');
  assert(tracker.done.includes('s2:failed') && tracker.done.includes('s3'));
}

await directFirstTests();
await badPostingTests();
await laneTests();
await fixtureTests();
await verifierTests();
console.log('scan coverage/provider tests OK');
