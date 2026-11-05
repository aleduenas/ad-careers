import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHiringCafeProvider } from './providers/hiring-cafe.mjs';
const dir = mkdtempSync(join(tmpdir(), 'career-cafe-'));
const hit = (id, country = 'CA') => ({
  apply_url: 'https://example.test/' + id,
  job_information: { title: 'Engineer' },
  v5_processed_job_data: {
    company_name: 'Example',
    workplace_countries: [country],
    formatted_workplace_location: country,
  },
});
try {
  const cachePath = join(dir, 'cache.json');
  const stamp = age => new Date(Date.now() - age * 3600000).toISOString();
  const save = roles => writeFileSync(cachePath, JSON.stringify({ version: 1, roles }));
  function fixture(pages) {
    const calls = [],
      closed = [],
      details = [];
    let n = 0;
    const browserType = {
      launch: async () => ({
        close: async () => {},
        newContext: async () => {
          const index = n++,
            spec = pages[index];
          calls.push(index);
          if (!spec) throw new Error('unexpected browser context');
          return {
            close: async () => closed.push(index),
            newPage: async () => ({
              goto: async url => {
                assert.ok(url.includes('/jobs/'));
                return { ok: () => !spec.status, status: () => spec.status || 200 };
              },
              waitForSelector: async () => {},
              evaluate: async () => spec.hits,
            }),
          };
        },
      }),
    };
    const provider = createHiringCafeProvider({
      cachePath,
      browserType,
      canonical: async h => {
        details.push(h.apply_url);
        return { text: 'Original full JD', method: 'fixture' };
      },
      renderCanonical: async () => null,
    });
    return { provider, calls, closed, details };
  }
  save({ fresh: { fetchedAt: stamp(1), hits: [hit('fresh')] } });
  let f = fixture([]);
  await f.provider.fetch({ search_roles: ['fresh'] }, { dryRun: true });
  assert.equal(f.calls.length, 0);
  for (const status of [403, 429]) {
    save({
      first: { fetchedAt: stamp(24), hits: [hit('cached')] },
      second: { fetchedAt: stamp(24), hits: [hit('next')] },
      expired: { fetchedAt: stamp(400), hits: [hit('expired')] },
    });
    const before = readFileSync(cachePath, 'utf8');
    f = fixture([{ status }]);
    const result = await f.provider.fetch(
      { search_roles: ['first', 'second', 'expired'], search_pacing_ms: 0 },
      { dryRun: true },
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.closed.length, 1);
    assert.equal(result.length, 2);
    assert.equal(readFileSync(cachePath, 'utf8'), before);
  }
  save({});
  f = fixture([
    { hits: [hit('a'), hit('outside', 'GB'), hit('filtered')] },
    { hits: [hit('a'), hit('b')] },
  ]);
  const result = await f.provider.fetch(
    { search_roles: ['first', 'second'], search_pacing_ms: 0 },
    { dryRun: true, shouldFetchContent: j => !j.url.endsWith('filtered') },
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.closed.length, 2);
  assert.deepEqual(f.details, ['https://example.test/a', 'https://example.test/b']);
  assert.equal(result.find(j => j.url.endsWith('filtered')).content, null);
  assert.deepEqual(JSON.parse(readFileSync(cachePath, 'utf8')).roles, {});
  save({});
  f = fixture([{ hits: null }]);
  await f.provider.fetch({ search_roles: ['challenge'], search_pacing_ms: 0 }, {});
  assert.deepEqual(JSON.parse(readFileSync(cachePath, 'utf8')).roles, {});
  f = fixture([{ hits: [] }]);
  await f.provider.fetch({ search_roles: ['valid-empty'], search_pacing_ms: 0 }, {});
  assert.ok(JSON.parse(readFileSync(cachePath, 'utf8')).roles['valid-empty']);
  console.log(
    'Hiring provider tests passed: fresh contexts, TTL, ban stop, fallback, filters, dedup, malformed pages and dry-run cache protection',
  );
} finally {
  if (
    dirname(dir) !== resolve(tmpdir()) ||
    !dir.startsWith(join(resolve(tmpdir()), 'career-cafe-'))
  )
    throw new Error('Unsafe fixture cleanup');
  rmSync(dir, { recursive: true, force: true });
}
