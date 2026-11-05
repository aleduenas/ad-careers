#!/usr/bin/env node

import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

import { buildTitleFilter, loadProviders } from './scan.mjs';
import ashbyProvider from './providers/ashby-api.mjs';
import greenhouseProvider from './providers/greenhouse-api.mjs';
import pinpointProvider, { parsePinpointResponse } from './providers/pinpoint.mjs';
import successFactorsProvider, {
  inferSuccessFactorsLocation,
  parseSuccessFactorsTiles,
} from './providers/successfactors.mjs';
import workableProvider, { parseWorkableMarkdown } from './providers/workable.mjs';
import { classifyPortal, verifyPortalEntries } from '../helpers/verify-portals.mjs';

import { root as ROOT } from '../lib/root.mjs';

async function fixtureTests() {
  const titleRules = { positive: ['Data Engineer'], negative: ['Staff', 'Lead', 'Manager'] };
  const companyTitles = buildTitleFilter(titleRules, ['Software Developer']);
  assert(companyTitles('Senior Software Developer'));
  assert(companyTitles('Data Engineer'));
  assert(!companyTitles('Lead, Software Developer'));
  assert(!companyTitles('Staff Software Developer'));
  assert(!companyTitles('Sales Associate'));
  assert(!buildTitleFilter(titleRules)('Software Developer'));

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

await fixtureTests();
await verifierTests();
console.log('scan coverage/provider tests OK');
