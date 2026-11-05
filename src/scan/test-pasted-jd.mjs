import assert from 'node:assert/strict';
import { rawJDDocument, normalizeUrl } from './add-pasted-jd.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const body = 'First line\n\n  Indented line\nFinal line';
const document = rawJDDocument({
  company: 'TD Bank',
  role: 'Security Engineer',
  url: 'https://example.test/job',
  body,
  date: '2026-09-19',
});
assert.ok(document.endsWith(body), 'the pasted JD body must be stored unchanged');
assert.match(
  document,
  /^---\ncompany: TD Bank\nrole: Security Engineer\nurl: https:\/\/example\.test\/job\nsource: manual-paste\nfetched: 2026-09-19\n---\n\n/,
);
assert.equal(normalizeUrl(' <example.test/job> '), 'https://example.test/job');
assert.equal(normalizeUrl('http://example.test/job'), 'http://example.test/job');
for (const value of [
  '',
  'https://',
  'https://bad host/job',
  'ftp://example.test/job',
  'javascript:alert(1)',
])
  assert.equal(normalizeUrl(value), '');
for (const [payload, message] of [
  [
    {
      url: 'https://',
      company: 'Example',
      role: 'Engineer',
      text: 'Full description. '.repeat(10),
    },
    /Invalid or missing job URL/,
  ],
  [
    { url: 'https://example.test/job', company: 'Example', role: 'Engineer', text: 'Short' },
    /too short/,
  ],
]) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./add-pasted-jd.mjs', import.meta.url)), '--dry-run'],
    { input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, message);
}
console.log(
  'Pasted-JD tests passed: verbatim body, URL normalization and invalid/short input rejection before database access.',
);
