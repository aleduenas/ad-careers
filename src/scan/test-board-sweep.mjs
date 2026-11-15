import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import provider, {
  buildLocationRequirement,
  parseCsv,
  trackedSlugs,
} from './providers/board-sweep.mjs';

const NLJ = String.fromCharCode(10);

assert.deepEqual(parseCsv('a,"b, ""c""",d\n1,2,3\r\n'), [
  ['a', 'b, "c"', 'd'],
  ['1', '2', '3'],
]);
assert.deepEqual(
  [...trackedSlugs([{ greenhouse_board: 'Acme' }, { careers_url: 'https://jobs.lever.co/Foo' }])],
  ['greenhouse:acme', 'lever:foo'],
);

const dir = mkdtempSync(path.join(tmpdir(), 'board-sweep-'));
try {
  const csv = path.join(dir, 'dir.csv');
  const stateFile = path.join(dir, 'state.json');
  writeFileSync(
    csv,
    [
      'ats_vendor,company_name,board_slug,last_crawled',
      'greenhouse,"Alpha, Inc.",alpha,2026-07-12',
      'ashby,Beta,beta,2026-07-12',
      'lever,Gamma,Gamma,2026-07-12',
      'greenhouse,Broken,broken,2026-07-12',
      'greenhouse,Tracked,tracked,2026-07-12',
      'greenhouse,Quiet,quiet,2026-07-12',
      '',
    ].join('\n'),
  );
  const entry = { name: 'Sweep', directory: csv, state_file: stateFile, pause_ms: 0 };

  const requested = [];
  const make = (extra = {}) => ({
    sleep: async () => {},
    now: () => Date.parse('2026-11-14T12:00:00Z'),
    trackedEntries: [{ greenhouse_board: 'tracked' }],
    passesFilters: j => /engineer/i.test(j.title),
    getJson: async url => {
      requested.push(url);
      if (url.includes('/boards/alpha/'))
        return {
          jobs: [
            {
              title: 'Data Engineer',
              absolute_url: 'https://a/1',
              content: 'x',
              location: { name: 'Toronto' },
            },
            {
              title: 'Sales Rep',
              absolute_url: 'https://a/2',
              content: 'x',
              location: { name: 'Toronto' },
            },
          ],
        };
      if (url.includes('/job-board/beta'))
        return {
          jobs: [
            {
              title: 'ML Engineer',
              jobUrl: 'https://b/1',
              descriptionHtml: 'y',
              location: 'Remote',
            },
          ],
        };
      if (url.includes('/postings/Gamma'))
        return [
          { text: 'Recruiter', hostedUrl: 'https://g/1', categories: {}, descriptionPlain: 'z' },
        ];
      if (url.includes('/boards/quiet/')) return { jobs: [] };
      throw new Error('HTTP 404 Not Found');
    },
    ...extra,
  });

  const lines = [];
  const log = console.log;
  console.log = l => lines.push(l);
  let jobs;
  try {
    jobs = await provider.fetch(entry, make());
  } finally {
    console.log = log;
  }
  assert.deepEqual(jobs.map(j => j.url).sort(), ['https://a/1', 'https://b/1']);
  assert.equal(jobs.find(j => j.url === 'https://a/1').company, 'Alpha, Inc.');
  assert.ok(!requested.some(u => u.includes('/boards/tracked/')), 'tracked boards are skipped');
  assert.match(
    lines.at(-1),
    /board-sweep: full sweep, 5 boards, 4 live, 1 errors, 4 postings read, 2 passed filters/,
  );
  // Greenhouse light list first; the content request only when a posting passes.
  const alpha = requested.filter(u => u.includes('/boards/alpha/'));
  assert.deepEqual(
    alpha.map(u => u.includes('content=true')),
    [false, true],
  );
  const quiet = requested.filter(u => u.includes('/boards/quiet/'));
  assert.equal(quiet.length, 1);
  assert.ok(!quiet[0].includes('content=true'));
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(state.lastFullSweep, '2026-11-14T12:00:00.000Z');
  assert.deepEqual(Object.keys(state.hot).sort(), ['ashby:beta', 'greenhouse:alpha']);
  assert.equal(state.dead['greenhouse:broken'].n, 1);

  // Within the interval only hot boards are read.
  requested.length = 0;
  console.log = () => {};
  const hot = await provider.fetch(entry, make({ now: () => Date.parse('2026-11-16T12:00:00Z') }));
  console.log = log;
  assert.equal(requested.length, 3, 'alpha: light list then content, beta: one request');
  assert.equal(hot.length, 2);

  // An old state means a full sweep again; three failures park a board until dead_retry_days.
  state.dead['greenhouse:broken'] = { n: 3, last: '2026-11-10' };
  writeFileSync(stateFile, JSON.stringify(state));
  requested.length = 0;
  console.log = () => {};
  await provider.fetch(entry, make({ now: () => Date.parse('2026-11-30T12:00:00Z') }));
  console.log = log;
  assert.ok(!requested.some(u => u.includes('/boards/broken/')), 'dead board is skipped');
  requested.length = 0;
  console.log = () => {};
  await provider.fetch(
    { ...entry, dead_retry_days: 5 },
    make({ now: () => Date.parse('2026-12-20T12:00:00Z') }),
  );
  console.log = log;
  assert.ok(
    requested.some(u => u.includes('/boards/broken/')),
    'dead board is retried after the delay',
  );

  // Dry runs and capped runs never write state; no hook returns everything.
  rmSync(stateFile);
  console.log = () => {};
  await provider.fetch(entry, make({ dryRun: true }));
  assert.equal(existsSync(stateFile), false, 'dry run leaves state untouched');
  const capped = await provider.fetch({ ...entry, sweep_limit: 1 }, make());
  assert.equal(existsSync(stateFile), false, 'capped run leaves state untouched');
  assert.equal(capped.length, 1);
  const unfiltered = await provider.fetch(entry, make({ passesFilters: undefined, dryRun: true }));
  console.log = log;
  assert.equal(unfiltered.length, 4);
  await assert.rejects(
    provider.fetch({ ...entry, directory: path.join(dir, 'none.csv') }, make()),
    /not found/,
  );

  // BOM, dot-only slugs and an unparseable lastFullSweep.
  {
    const csv4 = path.join(dir, 'bom.csv');
    const state4 = path.join(dir, 'bom-state.json');
    writeFileSync(
      csv4,
      String.fromCharCode(0xfeff) +
        [
          'ats_vendor,company_name,board_slug,last_crawled',
          'greenhouse,Dots,..,x',
          'greenhouse,Dot,.,x',
          'greenhouse,Ok,ok,x',
          '',
        ].join(NLJ),
    );
    writeFileSync(state4, JSON.stringify({ lastFullSweep: 'not a date', hot: {}, dead: {} }));
    const seen = [];
    const out = [];
    console.log = l => out.push(l);
    await provider.fetch(
      { name: 'S', directory: csv4, state_file: state4 },
      {
        dryRun: true,
        sleep: async () => {},
        now: () => Date.parse('2026-11-14T12:00:00Z'),
        getJson: async url => {
          seen.push(url);
          return { jobs: [] };
        },
      },
    );
    console.log = log;
    assert.equal(seen.length, 1, 'only the real slug is read');
    assert.ok(seen[0].includes('/boards/ok/'));
    assert.match(out.at(-1), /full sweep, 1 boards/, 'a bad lastFullSweep means a full sweep');
  }

  // require_location_any and max_per_board.
  {
    const match = buildLocationRequirement(['Canada', 'CAN', 'GTA']);
    assert.equal(match('Toronto, Canada'), true);
    assert.equal(match('remote - canada'), true);
    assert.equal(match('CAN - Remote'), true, 'short entries match as whole words');
    assert.equal(match('Scandinavia'), false);
    assert.equal(match('Remote'), false);
    assert.equal(match(''), false);
    assert.equal(match(undefined), false);
    assert.equal(buildLocationRequirement([])('Remote'), true);

    const csv5 = path.join(dir, 'cap.csv');
    writeFileSync(
      csv5,
      [
        'ats_vendor,company_name,board_slug,last_crawled',
        'greenhouse,Big,big,x',
        'greenhouse,Small,small,x',
        '',
      ].join(NLJ),
    );
    const ghJob = (n, loc) => ({
      title: 'Engineer ' + n,
      absolute_url: 'https://big/' + n,
      content: 'x',
      location: { name: loc },
    });
    const run = async (extra, ctxExtra = {}) => {
      const out = [];
      console.log = l => out.push(l);
      const res = await provider.fetch(
        { name: 'S', directory: csv5, state_file: path.join(dir, 'cap-state.json'), ...extra },
        {
          dryRun: true,
          sleep: async () => {},
          passesFilters: () => true,
          ...ctxExtra,
          getJson: async url =>
            url.includes('/boards/big/')
              ? {
                  jobs: [
                    ...Array.from({ length: 8 }, (_, n) => ghJob(n, 'Toronto, Canada')),
                    ghJob(9, 'Remote'),
                    ghJob(10, 'Costa Rica'),
                  ],
                }
              : {
                  jobs: [
                    {
                      title: 'Engineer',
                      absolute_url: 'https://small/1',
                      content: 'x',
                      location: { name: 'Remote' },
                    },
                  ],
                },
        },
      );
      console.log = log;
      return { res, out };
    };
    const capped = await run({ require_location_any: ['Canada'] });
    assert.equal(capped.res.length, 5, 'max_per_board defaults to 5, feed order kept');
    assert.deepEqual(
      capped.res.map(j => j.url),
      [0, 1, 2, 3, 4].map(n => 'https://big/' + n),
    );
    assert.match(capped.out.join(NLJ), /3 dropped by require_location_any/);
    assert.match(capped.out.join(NLJ), /board-sweep: capped 1 boards \(big 8\)/);
    // Already tracked postings neither come back nor count against the cap.
    const seenFive = await run(
      { require_location_any: ['Canada'] },
      { shouldFetchContent: job => Number(job.url.split('/').pop()) >= 5 },
    );
    assert.deepEqual(
      seenFive.res.map(j => j.url),
      [5, 6, 7].map(n => 'https://big/' + n),
    );
    assert.ok(!/capped/.test(seenFive.out.join(NLJ)), 'only 3 unseen: not capped');
    // Bad option values.
    const bad = await run({ max_per_board: Number.NaN, require_location_any: [42, '', null] });
    assert.ok(/no usable entry/.test(bad.out.join(NLJ)));
    assert.equal(bad.res.length, 6, 'default cap of 5 on big plus the small board, no requirement');
    const one = await run({ require_location_any: 'Canada', max_per_board: 'x' });
    assert.equal(
      one.res.length,
      5,
      'a single string is a one-entry list; a bad cap falls back to 5',
    );
    assert.ok(!/no usable entry/.test(one.out.join(NLJ)));
    const loose = await run({ max_per_board: 2 });
    assert.equal(loose.res.length, 3, 'a capped board plus the small board');
    assert.match(loose.out.join(NLJ), /capped 1 boards \(big 10\)/);
    assert.match(loose.out.join(NLJ), /0 dropped by require_location_any/);
  }

  // Per-vendor back-off: a 429 halves that vendor's pool, waits 5 s and retries the board once.
  // Rate limits and timeouts never count as dead; a 404 does.
  {
    const csv2 = path.join(dir, 'rate.csv');
    const state2 = path.join(dir, 'rate-state.json');
    writeFileSync(
      csv2,
      [
        'ats_vendor,company_name,board_slug,last_crawled',
        'greenhouse,G1,g1,x',
        'greenhouse,G2,g2,x',
        'ashby,A1,a1,x',
        'lever,L1,l1,x',
        'lever,L2,l2,x',
        '',
      ].join(NLJ),
    );
    const waits = [];
    const first = new Set();
    const e2 = { name: 'S', directory: csv2, state_file: state2, concurrency_per_vendor: 2 };
    const out = [];
    console.log = l => out.push(l);
    const res = await provider.fetch(e2, {
      sleep: async ms => waits.push(ms),
      getJson: async url => {
        if (url.includes('/boards/g1/') && !first.has('g1')) {
          first.add('g1');
          throw new Error('HTTP 429 Too Many Requests');
        }
        if (url.includes('/boards/g1/'))
          return {
            jobs: [
              {
                title: 'Engineer',
                absolute_url: 'https://g/1',
                content: 'x',
                location: { name: 'T' },
              },
            ],
          };
        if (url.includes('/boards/g2/')) throw new Error('Request timed out after 20000ms');
        if (url.includes('/job-board/a1')) return { jobs: [] };
        throw new Error('HTTP 404 Not Found');
      },
    });
    console.log = log;
    assert.deepEqual(
      res.map(j => j.url),
      ['https://g/1'],
    );
    assert.ok(waits.includes(5000), 'waits 5 s before the retry');
    const st = JSON.parse(readFileSync(state2, 'utf8'));
    assert.deepEqual(
      Object.keys(st.dead).sort(),
      ['lever:l1', 'lever:l2'],
      'timeouts are not dead',
    );
    assert.match(out.at(-1), /429\/503 responses: greenhouse 1, ashby 0, lever 0/);
  }

  // More than 50 rate-limited boards stop that vendor and the sweep is not recorded as complete.
  {
    const csv3 = path.join(dir, 'flood.csv');
    const state3 = path.join(dir, 'flood-state.json');
    writeFileSync(
      csv3,
      [
        'ats_vendor,company_name,board_slug,last_crawled',
        ...Array.from({ length: 80 }, (_, n) => `greenhouse,G${n},g${n},x`),
        'ashby,A1,a1,x',
        '',
      ].join(NLJ),
    );
    const out = [];
    console.log = l => out.push(l);
    const res = await provider.fetch(
      { name: 'S', directory: csv3, state_file: state3 },
      {
        sleep: async () => {},
        getJson: async url => {
          if (url.includes('/job-board/a1'))
            return {
              jobs: [
                { title: 'Engineer', jobUrl: 'https://a/1', descriptionHtml: 'y', location: 'R' },
              ],
            };
          throw new Error('HTTP 503 Service Unavailable');
        },
      },
    );
    console.log = log;
    assert.equal(res.length, 1, 'the healthy vendor is still read');
    assert.ok(out.some(l => /stopped reading greenhouse/.test(l)));
    assert.equal(JSON.parse(readFileSync(state3, 'utf8')).lastFullSweep, null);
    assert.ok(
      !Object.keys(JSON.parse(readFileSync(state3, 'utf8')).dead).length,
      '503 is never dead',
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log('Board sweep tests passed.');
