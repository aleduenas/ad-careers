#!/usr/bin/env node

import assert from 'node:assert/strict';
import { gate } from './location-gate-core.mjs';

const usOnlyRemote = `---
location: Remote, United States
type: Remote
---

This is a remote-first role. The employee must be based in the United States.
`;

assert.equal(
  gate('https://careers.example.com/remote-role', 'Example', 'Security Engineer', usOnlyRemote)
    .decision,
  'FAIL',
  'explicit US-only language must override remote metadata',
);

const canadaRemote = `---
location: Remote, Canada
type: Remote
---

This role may be performed remotely from anywhere in Canada.
`;

assert.equal(
  gate('https://careers.example.com/canada-role', 'Example', 'Security Engineer', canadaRemote)
    .decision,
  'PASS',
);

assert.equal(
  gate(
    'https://jobs.example.com/role',
    'Example',
    'Machine Learning Engineer - US Remote',
    'This role is remote.',
    'New York, United States (Remote)',
  ).decision,
  'FAIL',
);

assert.equal(
  gate(
    'https://jobs.example.com/role',
    'Example',
    'Data Engineer',
    'Build and operate production data pipelines.',
    'Cambridge, United Kingdom',
  ).decision,
  'FAIL',
);

assert.equal(
  gate(
    'https://jobs.example.com/role',
    'Example',
    'Senior Security Engineer',
    'This role is remote.',
    'Remote (United States | Canada)',
  ).decision,
  'PASS',
);

assert.equal(
  gate(
    'https://jobs.example.com/role',
    'Example',
    'Research Engineer',
    'Travel is required.',
    'Remote-Friendly (Travel-Required) | San Francisco, CA | New York City, NY',
  ).decision,
  'FAIL',
);

console.log('location gate tests passed');
for (const location of ['Ottawa, Ontario', 'London, Ontario'])
  assert.equal(
    gate('https://example.test/job', 'Example', 'Engineer', null, location).decision,
    'FAIL',
  );
for (const location of ['Markham, Ontario', 'Brampton, Ontario', 'Oakville, Ontario'])
  assert.equal(
    gate('https://example.test/job', 'Example', 'Engineer', null, location).decision,
    'PASS',
  );
