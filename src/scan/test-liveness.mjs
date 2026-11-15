import assert from 'node:assert/strict';
import {
  OUTAGE_LIMITS,
  SLOW_DOWN,
  checkPosting,
  closureSigns,
  decideActions,
  limitFetch,
  runLiveness,
} from './liveness.mjs';
import { boardKey } from './liveness-urls.mjs';

process.env.CAREER_OPS_TEST_GUARD = '1';

const reply = (status, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: () => null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
// routes: array of [predicate(url, options), response | function]
function mock(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    for (const [match, answer] of routes) {
      if (typeof match === 'string' ? url.startsWith(match) : match(url, options))
        return typeof answer === 'function' ? answer(url, options) : answer;
    }
    throw new Error('unexpected request ' + url);
  };
  impl.calls = calls;
  return impl;
}
const state = async (url, routes, extra = {}) =>
  (await checkPosting(url, { fetchImpl: mock(routes), ...extra })).state;

// Per-board open and closed answers.
const gh = 'https://boards.greenhouse.io/acme/jobs/123';
const ghApi = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123';
assert.equal(await state(gh, [[ghApi, reply(200, {})]]), 'open');
assert.equal(await state(gh, [[ghApi, reply(404)]]), 'closed');
assert.equal(await state(gh, [[ghApi, reply(410)]]), 'closed');

const lv = 'https://jobs.lever.co/acme/abc-123';
assert.equal(
  await state(lv, [['https://api.lever.co/v0/postings/acme/abc-123', reply(200, {})]]),
  'open',
);
assert.equal(
  await state(lv, [['https://api.lever.co/v0/postings/acme/abc-123', reply(404)]]),
  'closed',
);

const ab = 'https://jobs.ashbyhq.com/acme/uuid-1';
const abApi = 'https://api.ashbyhq.com/posting-api/job-board/acme';
assert.equal(await state(ab, [[abApi, reply(200, { jobs: [{ id: 'uuid-1' }] })]]), 'open');
assert.equal(await state(ab, [[abApi, reply(200, { jobs: [{ id: 'other' }] })]]), 'closed');
assert.equal(
  await state(ab, [[abApi, reply(200, { jobs: [] })]]),
  'unknown',
  'empty list proves nothing',
);
assert.equal(await state(ab, [[abApi, reply(200, { nope: 1 })]]), 'unknown');

const sr = 'https://jobs.smartrecruiters.com/Acme/744000-data-engineer';
const srApi = 'https://api.smartrecruiters.com/v1/companies/Acme/postings/744000';
assert.equal(await state(sr, [[srApi, reply(200, {})]]), 'open');
assert.equal(await state(sr, [[srApi, reply(404)]]), 'closed');

const wd = 'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Toronto/Data-Engineer_R-55';
const wdApi =
  'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/job/Toronto/Data-Engineer_R-55';
const wdSearch = 'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/jobs';
assert.equal(
  await state(wd, [[wdApi, reply(200, { jobPostingInfo: { canApply: true } })]]),
  'open',
);
assert.equal(
  await state(wd, [[wdApi, reply(200, { jobPostingInfo: { canApply: false } })]]),
  'closed',
);
assert.equal(await state(wd, [[wdApi, reply(404)]]), 'closed');
assert.equal(await state(wd, [[wdApi, reply(500)]]), 'unknown');
// 403 is settled by searching the board.
const searchHit = reply(200, {
  total: 1,
  jobPostings: [{ externalPath: '/job/Toronto/Data-Engineer_R-55' }],
});
assert.equal(
  await state(wd, [
    [wdApi, reply(403)],
    [wdSearch, searchHit],
  ]),
  'open',
);
const searchMiss = reply(200, { total: 1, jobPostings: [{ externalPath: '/job/X/Other_R-1' }] });
assert.equal(
  await state(wd, [
    [wdApi, reply(403)],
    [wdSearch, searchMiss],
  ]),
  'closed',
);
assert.equal(
  await state(wd, [
    [wdApi, reply(403)],
    [wdSearch, reply(403)],
  ]),
  'unknown',
);
assert.equal(
  await state(wd, [
    [wdApi, reply(403)],
    [wdSearch, reply(200, { total: 0, jobPostings: [] })],
  ]),
  'unknown',
  'an empty search is no proof',
);

const wk = 'https://apply.workable.com/acme/j/ABC123/';
const wkApi = 'https://apply.workable.com/api/v2/accounts/acme/jobs/ABC123';
assert.equal(await state(wk, [[wkApi, reply(200, {})]]), 'open');
assert.equal(await state(wk, [[wkApi, reply(404)]]), 'closed');

// BambooHR: list only; the posting page is never requested.
const bh = 'https://acme.bamboohr.com/careers/42';
const bhList = 'https://acme.bamboohr.com/careers/list';
{
  const f = mock([[bhList, reply(200, { result: [{ id: '42' }, { id: 7 }] })]]);
  assert.equal((await checkPosting(bh, { fetchImpl: f })).state, 'open');
  assert.deepEqual(
    f.calls.map(c => c.url),
    [bhList],
  );
  const g = mock([[bhList, reply(200, { result: [{ id: '7' }] })]]);
  assert.equal((await checkPosting(bh, { fetchImpl: g })).state, 'closed');
  assert.ok(g.calls.every(c => c.url === bhList));
}

const bz = 'https://acme.breezy.hr/p/abc123-data-engineer';
const bzList = 'https://acme.breezy.hr/json';
assert.equal(
  await state(bz, [[bzList, reply(200, [{ friendly_id: 'abc123-data-engineer' }])]]),
  'open',
);
assert.equal(await state(bz, [[bzList, reply(200, [{ friendly_id: 'zzz-other' }])]]), 'closed');

const pp = 'https://acme.pinpointhq.com/en/postings/uuid-9';
const ppList = 'https://acme.pinpointhq.com/postings.json';
const ppRow = id => ({
  data: [{ title: 'T', url: `https://acme.pinpointhq.com/en/postings/${id}` }],
});
assert.equal(await state(pp, [[ppList, reply(200, ppRow('uuid-9'))]]), 'open');
assert.equal(await state(pp, [[ppList, reply(200, ppRow('uuid-1'))]]), 'closed');

const sfTile = id =>
  `<li class="job-tile job-id-${id}"><a data-url="/job/Toronto/Role-${id}/" class="jobTitle-link">Role ${id}</a></li>`;
const sf2 = 'https://career5.successfactors.eu/job/Toronto/Role-500/500-en_US/';
const sf2Base = 'https://career5.successfactors.eu/tile-search-results/';
const sf2Routes = ids => [
  [
    url => url.startsWith(sf2Base) && url.endsWith('startrow=0'),
    reply(200, ids.map(sfTile).join('')),
  ],
  [sf2Base, reply(200, '<ul class="search-results"></ul>')],
];
assert.equal(await state(sf2, sf2Routes([499, 500])), 'open');
assert.equal(await state(sf2, sf2Routes([499, 501])), 'closed');
assert.equal(await state(sf2, [[sf2Base, reply(200, '<html></html>')]]), 'unknown');
// A blocked later page (200, no tiles, not a tile page) is never the end of the list.
{
  const blocked = [
    [
      url => url.startsWith(sf2Base) && url.endsWith('startrow=0'),
      reply(200, [499, 501].map(sfTile).join('')),
    ],
    [sf2Base, reply(200, '<html><title>Verify your request</title></html>')],
  ];
  assert.equal(await state(sf2, blocked), 'unknown');
}

// Blocked, failed, challenge: unknown, never closed.
for (const status of [403, 429, 500, 503]) {
  assert.equal(await state(gh, [[ghApi, reply(status)]]), 'unknown', `greenhouse ${status}`);
  assert.equal(await state(bz, [[bzList, reply(status)]]), 'unknown', `breezy ${status}`);
  assert.equal(
    await state('https://careers.example.org/job/9', [
      ['https://careers.example.org', reply(status)],
    ]),
    'unknown',
    `page ${status}`,
  );
}
assert.equal(
  await state(gh, [
    [
      ghApi,
      () => {
        throw new Error('Request timed out after 20000ms');
      },
    ],
  ]),
  'unknown',
);
assert.equal(await state(bz, [[bzList, reply(200, '<html>Just a moment...</html>')]]), 'unknown');
assert.equal(
  await state('https://careers.example.org/job/9', [
    [
      'https://careers.example.org',
      reply(200, '<html><title>Just a moment...</title>Verify you are human</html>'),
    ],
  ]),
  'unknown',
);

// hiring.cafe is never requested.
{
  const f = mock([]);
  const r = await checkPosting('https://hiring.cafe/viewjob/abc', { fetchImpl: f });
  assert.equal(r.state, 'unknown');
  assert.equal(f.calls.length, 0);
  assert.equal((await checkPosting('not a url', { fetchImpl: f })).state, 'unknown');
}

// No-API sites: plain request, 404 closed, rendered step injectable, never a real browser here.
const page = 'https://careers.example.org/jobs/12345';
const posting = (extra = {}) =>
  `<html><script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title: 'Data Engineer',
    description: 'x'.repeat(400),
    ...extra,
  })}</script></html>`;
assert.equal(await state(page, [[page, reply(404)]]), 'closed');
assert.equal(await state(page, [[page, reply(200, posting())]]), 'open');
assert.equal(
  (
    await checkPosting(page, {
      fetchImpl: mock([[page, reply(200, posting({ validThrough: '2020-01-01' }))]]),
    })
  ).state,
  'probably_closed',
);
assert.equal(
  await state(page, [[page, reply(200, '<html><div id="root"></div></html>')]]),
  'unknown',
  'no renderer, no guess',
);
{
  let rendered = 0;
  const empty = [[page, reply(200, '<html><div id="root"></div></html>')]];
  const render = html => async url => {
    rendered++;
    return { finalUrl: url, html };
  };
  const r1 = await checkPosting(page, {
    fetchImpl: mock(empty),
    renderPage: render('<body>Sorry, this job is no longer available.</body>'),
  });
  assert.equal(r1.state, 'probably_closed');
  const r2 = await checkPosting(page, {
    fetchImpl: mock(empty),
    renderPage: async () => ({
      finalUrl: 'https://careers.example.org/jobs',
      html: '<body>Search jobs</body>',
    }),
  });
  assert.equal(r2.state, 'probably_closed', 'final address lost the job ID');
  const r3 = await checkPosting(page, { fetchImpl: mock(empty), renderPage: render(posting()) });
  assert.equal(r3.state, 'open');
  const r4 = await checkPosting(page, {
    fetchImpl: mock(empty),
    renderPage: render('<body>Search jobs</body>'),
  });
  assert.equal(r4.state, 'unknown', 'no sign, no content: unknown');
  const r5 = await checkPosting(page, {
    fetchImpl: mock(empty),
    renderPage: render('<title>Just a moment...</title>'),
  });
  assert.equal(r5.state, 'unknown', 'challenge is never closure');
  assert.equal(rendered, 4);
  assert.equal(
    closureSigns({
      url: new URL(page),
      finalUrl: page,
      html: '<script>"no longer available"</script>',
    }),
    null,
    'script text is not a sign',
  );
}

// Decision layer.
const job = (id, status, extra = {}) => ({
  id,
  status,
  revision: 1,
  board: 'b' + id,
  state: 'open',
  restored: false,
  activeTask: false,
  ...extra,
});
const act = (jobs, limits) => decideActions(jobs, limits).actions.map(a => a.action);
assert.deepEqual(
  act([
    job(1, 'Pending', { state: 'closed' }),
    job(2, 'Evaluated', { state: 'closed' }),
    job(3, 'Applied', { state: 'closed' }),
    job(4, 'Pending', { state: 'probably_closed' }),
    job(5, 'Applied', { state: 'probably_closed' }),
    job(6, 'Pending', { state: 'unknown' }),
    job(7, 'Pending', { state: 'open' }),
    job(8, 'Pending', { state: 'closed', restored: true }),
    job(9, 'Evaluated', { state: 'closed', activeTask: true }),
    job(10, 'Interview', { state: 'closed' }),
  ]),
  ['discard', 'discard', 'flag', 'flag', 'flag', 'none', 'none', 'flag', 'skip', 'skip'],
);
{
  // Applied is never discarded, whatever the state.
  for (const s of ['closed', 'probably_closed', 'open', 'unknown'])
    assert.notEqual(act([job(1, 'Applied', { state: s })])[0], 'discard');
  // A restored job is flagged only.
  assert.equal(act([job(1, 'Pending', { state: 'closed', restored: true })])[0], 'flag');
  assert.equal(act([job(1, 'Evaluated', { state: 'closed', restored: true })])[0], 'flag');
}
{
  // Board limit: 5 closed of 8 on one board (>50%, >=5): held. 4 of 5 stays.
  const board = (n, total) =>
    Array.from({ length: total }, (_, i) =>
      job(i + 1, 'Pending', { board: 'x', state: i < n ? 'closed' : 'open' }),
    );
  const held = decideActions(board(5, 8));
  assert.equal(held.summary.heldBack, 5);
  assert.deepEqual(held.summary.heldBoards, ['x']);
  assert.ok(held.actions.filter(a => a.heldBack).every(a => a.action === 'flag'));
  assert.equal(held.summary.wouldDiscard, 0);
  assert.equal(held.summary.wouldFlag, 5);
  const fine = decideActions(board(4, 5)); // 4 < 5 minimum
  assert.equal(fine.summary.heldBack, 0);
  assert.equal(fine.summary.wouldDiscard, 4);
  const half = decideActions(board(5, 10)); // exactly 50% is not over
  assert.equal(half.summary.heldBack, 0);
  // Other boards are unaffected by one board's outage.
  const mixed = decideActions([
    ...board(5, 6),
    job(50, 'Pending', { board: 'y', state: 'closed' }),
  ]);
  assert.equal(mixed.actions.at(-1).action, 'discard');
}
{
  // Run limit: 20 closed spread over single-job boards of 60 jobs (>30%, >=20): all held.
  const jobs = Array.from({ length: 60 }, (_, i) =>
    job(i + 1, 'Pending', { board: 'b' + i, state: i < 20 ? 'closed' : 'open' }),
  );
  const held = decideActions(jobs);
  assert.equal(held.summary.runHeld, true);
  assert.equal(held.summary.heldBack, 20);
  assert.equal(held.summary.wouldDiscard, 0);
  const under = decideActions(
    Array.from({ length: 70 }, (_, i) =>
      job(i + 1, 'Pending', { board: 'b' + i, state: i < 20 ? 'closed' : 'open' }),
    ),
  ); // 20/70 = 28.6%
  assert.equal(under.summary.runHeld, false);
  assert.equal(under.summary.wouldDiscard, 20);
  assert.equal(OUTAGE_LIMITS.board.min, 5);
  assert.equal(OUTAGE_LIMITS.run.min, 20);
}

assert.equal(boardKey(gh), 'greenhouse:acme');
assert.equal(boardKey(page), 'host:careers.example.org');

// Per-host concurrency bound (and global bound).
{
  let inFlight = 0;
  let peak = 0;
  const perHostPeak = {};
  const live = {};
  const slow = async url => {
    const host = new URL(url).hostname;
    inFlight++;
    live[host] = (live[host] || 0) + 1;
    peak = Math.max(peak, inFlight);
    perHostPeak[host] = Math.max(perHostPeak[host] || 0, live[host]);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    live[host]--;
    return reply(200, {});
  };
  const limited = limitFetch(slow, { concurrency: 4, perHost: 2 });
  const urls = Array.from({ length: 24 }, (_, i) => `https://h${i % 3}.example.com/${i}`);
  await Promise.all(urls.map(u => limited(u, {})));
  assert.ok(
    Object.values(perHostPeak).every(n => n <= 2),
    JSON.stringify(perHostPeak),
  );
  assert.ok(peak <= 4 && peak > 2, `peak ${peak}`);
  assert.equal(Object.keys(perHostPeak).length, 3);
}

// Runner: dry run calls no write function; without --dry-run it refuses until wired.
{
  const rows = [
    { id: 1, url: gh, status: 'Pending', revision: 3, restored: false, activeTask: false },
    { id: 2, url: bz, status: 'Applied', revision: 1, restored: false, activeTask: false },
  ];
  const f = mock([
    [ghApi, reply(404)],
    [bzList, reply(200, [{ friendly_id: 'other' }])],
  ]);
  let writes = 0;
  const write = { recordCheck: async () => writes++, discard: async () => (writes++, 'discarded') };
  const lines = [];
  const dry = await runLiveness({
    loadJobs: async () => rows,
    dryRun: true,
    write,
    fetchImpl: f,
    log: l => lines.push(l),
  });
  assert.equal(writes, 0, 'dry run writes nothing');
  assert.deepEqual(
    dry.actions.map(a => a.action),
    ['discard', 'flag'],
  );
  assert.match(lines.join('\n'), /Would discard 1, would flag 1, held back by an outage limit 0/);
  assert.match(lines.join('\n'), /Dry run: nothing written/);
  await assert.rejects(
    runLiveness({ loadJobs: async () => rows, dryRun: false, fetchImpl: f, log() {} }),
    /needs the database writers/,
  );
  assert.equal(f.calls.length, 2, 'the refused run made no further requests');
  const real = await runLiveness({
    loadJobs: async () => rows,
    dryRun: false,
    write,
    fetchImpl: f,
    log() {},
  });
  assert.equal(real.discarded, 1);
  assert.equal(writes, 3, 'two check records and one discard');
}

// Himalayas: its own pages answer 403, so the search API is asked; absence is never closed.
{
  const him = 'https://himalayas.app/companies/acme/jobs/data-engineer-12345';
  const search = 'https://himalayas.app/jobs/api/search';
  const found = reply(200, {
    jobs: [{ guid: 'https://himalayas.app/companies/acme/jobs/data-engineer-12345' }],
  });
  const f = mock([[search, found]]);
  assert.equal((await checkPosting(him, { fetchImpl: f })).state, 'open');
  assert.ok(
    f.calls.every(call => call.url.startsWith(search)),
    'the 403 page is never requested',
  );
  assert.equal(await state(him, [[search, reply(200, { jobs: [{ guid: 'other' }] })]]), 'unknown');
  assert.equal(await state(him, [[search, reply(403)]]), 'unknown');
  assert.equal(boardKey(him), 'himalayas:acme');
}

// Runner stored actions: discarded, held_back, flagged, none, a conflict stored as none, skip not stored.
{
  const make = (id, url, status, extra = {}) => ({
    id: String(id),
    url,
    status,
    revision: '1',
    restored: false,
    activeTask: false,
    ...extra,
  });
  const rows = [
    make(1, gh, 'Pending'),
    make(2, 'https://boards.greenhouse.io/acme/jobs/124', 'Applied'),
    make(3, 'https://boards.greenhouse.io/acme/jobs/125', 'Pending', { restored: true }),
    make(4, 'https://boards.greenhouse.io/acme/jobs/126', 'Evaluated'),
    make(5, 'https://boards.greenhouse.io/acme/jobs/127', 'Pending', { activeTask: true }),
    make(6, 'https://boards.greenhouse.io/acme/jobs/128', 'Pending'),
  ];
  const f = mock([
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs/128', reply(200, {})],
    ['https://boards-api.greenhouse.io', reply(404)],
  ]);
  const stored = [];
  const discarded = [];
  const write = {
    recordCheck: async (job, result, action) => stored.push([job.id, result.state, action]),
    discard: async job => {
      discarded.push(job.id);
      return job.id === '4' ? 'conflict' : 'discarded';
    },
  };
  const out = await runLiveness({ loadJobs: async () => rows, write, fetchImpl: f, log() {} });
  assert.deepEqual(discarded, ['1', '4']);
  assert.deepEqual(stored, [
    ['1', 'closed', 'discarded'],
    ['2', 'closed', 'flagged'],
    ['3', 'closed', 'flagged'],
    ['4', 'closed', 'none'],
    ['6', 'open', 'none'],
  ]);
  assert.equal(out.discarded, 1);
  assert.equal(out.conflicts, 1);
  // Under an outage limit nothing is discarded and every closed job is stored as held_back.
  const many = Array.from({ length: 6 }, (_, i) =>
    make(10 + i, `https://boards.greenhouse.io/acme/jobs/${200 + i}`, 'Pending'),
  );
  const held = [];
  const writeHeld = {
    recordCheck: async (job, result, action) => held.push(action),
    discard: async () => assert.fail('an outage limit never discards'),
  };
  const f2 = mock([['https://boards-api.greenhouse.io', reply(404)]]);
  await runLiveness({ loadJobs: async () => many, write: writeHeld, fetchImpl: f2, log() {} });
  assert.deepEqual(held, Array(6).fill('held_back'));
}

// One 429 stops all further requests to that host for the run; other hosts continue.
{
  const slowRows = Array.from({ length: 12 }, (_, i) => ({
    id: String(100 + i),
    url: `https://himalayas.app/companies/c${i}/jobs/role-${i}`,
    status: 'Pending',
    revision: '1',
    restored: false,
    activeTask: false,
  }));
  const okRows = Array.from({ length: 3 }, (_, i) => ({
    id: String(200 + i),
    url: `https://boards.greenhouse.io/ok/jobs/${300 + i}`,
    status: 'Pending',
    revision: '1',
    restored: false,
    activeTask: false,
  }));
  const f = mock([
    ['https://himalayas.app', reply(429)],
    ['https://boards-api.greenhouse.io', reply(200, {})],
  ]);
  const out = await runLiveness({
    loadJobs: async () => [...slowRows, ...okRows],
    dryRun: true,
    fetchImpl: f,
    log() {},
    concurrency: { concurrency: 4, perHost: 1 },
  });
  const himalayasCalls = f.calls.filter(c => c.url.startsWith('https://himalayas.app')).length;
  assert.ok(himalayasCalls <= 2, `requests after the first 429: ${himalayasCalls}`);
  assert.equal(f.calls.filter(c => c.url.includes('greenhouse')).length, 3);
  assert.equal(out.summary.open, 3);
  assert.equal(out.summary.unknown, 12);
  assert.ok(out.actions.every(a => a.action === 'none'));
  const r = await checkPosting(slowRows[0].url, {
    fetchImpl: mock([['https://himalayas.app', reply(429)]]),
  });
  assert.deepEqual([r.state, r.detail], ['unknown', SLOW_DOWN]);
  // The renderer obeys it too: a slowed host is not rendered again.
  let renders = 0;
  const empty = 'https://careers.example.org/jobs/';
  const renderRows = [1, 2, 3].map(n => ({
    id: String(400 + n),
    url: empty + n + '00',
    status: 'Pending',
    revision: '1',
    restored: false,
    activeTask: false,
  }));
  await runLiveness({
    loadJobs: async () => renderRows,
    dryRun: true,
    fetchImpl: mock([[empty, reply(200, '<html><div id="root"></div></html>')]]),
    renderPage: async () => (renders++, { slowDown: true }),
    log() {},
    concurrency: { concurrency: 1, perHost: 1 },
  });
  assert.equal(renders, 1);
}

// LinkedIn and Indeed (and subdomains) are never fetched or rendered, like hiring.cafe.
for (const link of [
  'https://www.linkedin.com/jobs/view/123',
  'https://linkedin.com/jobs/view/123',
  'https://ca.indeed.com/viewjob?jk=abc',
  'https://indeed.com/viewjob?jk=abc',
  'https://hiring.cafe/viewjob/x',
]) {
  const f = mock([]);
  let renders = 0;
  const r = await checkPosting(link, {
    fetchImpl: f,
    renderPage: async () => (renders++, { html: '' }),
  });
  assert.equal(r.state, 'unknown', link);
  assert.equal(r.method, 'not-checked');
  assert.equal(f.calls.length + renders, 0, link);
}
assert.equal(
  await state('https://notlinkedin.com/jobs/1', [['https://notlinkedin.com', reply(404)]]),
  'closed',
);

// A paged or capped list never proves absence; a dropped Pinpoint item is not absent.
{
  const bhList2 = 'https://acme.bamboohr.com/careers/list';
  assert.equal(
    await state(bh, [[bhList2, reply(200, { result: [{ id: '7' }], total: 40 })]]),
    'unknown',
  );
  assert.equal(
    await state(bh, [[bhList2, reply(200, { result: [{ id: '7' }], meta: { next_page: 'x' } })]]),
    'unknown',
  );
  assert.equal(
    await state(bh, [[bhList2, reply(200, { result: [{ id: '7' }], total: 1 })]]),
    'closed',
  );
  assert.equal(
    await state(ab, [[abApi, reply(200, { jobs: [{ id: 'o' }], nextCursor: 'c' })]]),
    'unknown',
  );
  assert.equal(await state(bz, [[bzList, reply(200, [{ friendly_id: 'zzz' }])]]), 'closed');
  const ppDropped = {
    data: [{ title: '', url: 'https://acme.pinpointhq.com/en/postings/uuid-9' }],
  };
  assert.equal(
    await state(pp, [[ppList, reply(200, ppDropped)]]),
    'open',
    'a dropped item still counts as present',
  );
}

// A failing discard and a task that started late never abort the run.
{
  const row = (id, n) => ({
    id: String(id),
    url: `https://boards.greenhouse.io/acme/jobs/${n}`,
    status: 'Pending',
    revision: '1',
    restored: false,
    activeTask: false,
  });
  const rows = [row(1, 501), row(2, 502), row(3, 503)];
  const stored = [];
  const f = mock([['https://boards-api.greenhouse.io', reply(404)]]);
  let reads = 0;
  const loadJobs = async id => {
    if (!id) return rows;
    reads++;
    return rows.filter(r => r.id === id).map(r => (r.id === '2' ? { ...r, activeTask: true } : r));
  };
  const write = {
    recordCheck: async (job, result, action) => stored.push([job.id, action, result.detail]),
    discard: async job => {
      if (job.id === '1') throw new Error('database hiccup');
      return 'discarded';
    },
  };
  const out = await runLiveness({ loadJobs, write, fetchImpl: f, log() {} });
  assert.deepEqual(
    stored.map(x => [x[0], x[1]]),
    [
      ['1', 'none'],
      ['2', 'none'],
      ['3', 'discarded'],
    ],
  );
  assert.match(stored[0][2], /discard failed/i);
  assert.match(stored[1][2], /task started/i);
  assert.deepEqual([out.discarded, out.discardFailed, out.startedLate], [1, 1, 1]);
  assert.equal(reads, 3, 'the task flag is re-read before each discard');
}

console.log('liveness tests OK');
