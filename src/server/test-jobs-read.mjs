import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobsReader, isoWeekKey, normalizeJobsQuery } from './jobs-read.mjs';
import { resolveJobMaterials } from './jobs-materials.mjs';
import { readReportCompensation } from './jobs-compensation.mjs';
import { mkdtemp, mkdir, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const HUGE_ID = '900719925474099312345';

function row(id, status, values = {}) {
  return {
    id: String(id),
    revision: '0',
    company: `Company ${id}`,
    role: `Role ${id}`,
    url: `https://example.invalid/${id}`,
    status,
    score: null,
    source_date: '2026-01-01',
    first_seen: null,
    status_date: null,
    discard_reason: null,
    notes: '',
    report_path: null,
    salary_min: null,
    salary_max: null,
    ...values,
  };
}

const dataRows = [
  row(HUGE_ID, 'Pending', {
    score: '5.0',
    notes: 'pending interview',
    salary_min: '10',
    salary_max: '20',
  }),
  row('2', 'Evaluated', { score: '4.0', status_date: '2026-01-03', notes: 'unicode Café %_ term' }),
  row('3', 'Applied', {
    score: '3.9',
    status_date: '2026-01-02',
    salary_min: '100000',
    salary_max: '140000',
  }),
  row('4', 'Interview', { score: '4.5', status_date: null }),
  row('5', 'Offer', { score: '5.0' }),
  row('6', 'Rejected', {
    score: '3.0',
    notes: 'Reached INTERVIEW before rejection',
    discard_reason: null,
  }),
  row('7', 'Discarded', { score: null, discard_reason: 'duplicate role' }),
  row('8', 'Ghosted', { score: '4.2' }),
];

function readerFor(rows = dataRows, extras = {}) {
  const calls = [];
  const reader = createJobsReader({
    query: async sql => {
      calls.push(sql);
      return rows;
    },
    resolveMaterials: async input =>
      new Map(input.map(item => [item.id, { cv: item.id === '3', letter: false }])),
    readCompensation: async () => ({ text: '$125k-$145k', state: 'report' }),
    cursorKey: Buffer.alloc(32, 7),
    rootDir: 'C:\\synthetic\\career-ops',
    ...extras,
  });
  return { reader, calls };
}

async function withOwnedTemp(callback) {
  const path = resolve(await mkdtemp(join(tmpdir(), `career-ops-read-${randomUUID()}-`)));
  const canonical = await realpath(path);
  assert.equal(canonical.toLowerCase(), path.toLowerCase());
  assert.equal((await lstat(path)).isSymbolicLink(), false);
  try {
    await callback(path);
  } finally {
    const beforeCleanup = await realpath(path);
    assert.equal(beforeCleanup.toLowerCase(), path.toLowerCase());
    assert.equal((await lstat(path)).isSymbolicLink(), false);
    await rm(path, { recursive: true, force: true });
  }
}

test('query normalization is strict, bounded and applies company direction default', () => {
  assert.deepEqual(normalizeJobsQuery({ sort: 'company' }).query, {
    q: '',
    filter: 'all',
    sort: 'company',
    direction: 'asc',
    grouped: true,
    limit: 50,
  });
  assert.equal(normalizeJobsQuery({}).query.direction, 'desc');
  for (const raw of [
    { extra: '1' },
    { q: 'x'.repeat(201) },
    { grouped: 'yes' },
    { limit: '01' },
    { limit: '201' },
    { direction: 'sideways' },
    { filter: 'SKIP' },
    { cursor: '' },
  ])
    assert.throws(
      () => normalizeJobsQuery(raw),
      error => error.publicCode === 'INVALID_REQUEST',
    );
});

test('list is one SELECT snapshot with exact filters, safe decimal IDs and stable order', async () => {
  const { reader, calls } = readerFor();
  const result = await reader.list({ filter: 'all', sort: 'score', limit: '50' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\s*SELECT/i);
  assert.doesNotMatch(calls[0], /\b(INSERT|UPDATE|DELETE|CALL|ghost_stale_applications)\b/i);
  assert.equal(result.totalCount, 7);
  assert.equal(
    result.items.some(item => item.id === HUGE_ID),
    false,
  );
  assert.deepEqual(
    result.items.map(item => item.id),
    ['4', '5', '3', '2', '8', '6', '7'],
  );
  const pending = await reader.list({ filter: 'pending' });
  assert.equal(pending.items[0].score, 5);
  assert.equal(pending.items[0].compensation.state, 'notEvaluated');
  assert.equal(
    (await reader.list({ filter: 'top' })).items.some(item => item.id === HUGE_ID),
    false,
  );
  const offer = await reader.list({ filter: 'offer' });
  assert.deepEqual(
    offer.items.map(item => item.status),
    ['Offer'],
  );
});

test('literal Unicode and wildcard characters search notes; ID search preserves bigint identity', async () => {
  const { reader } = readerFor();
  assert.deepEqual(
    (await reader.list({ q: 'café %_' })).items.map(item => item.id),
    ['2'],
  );
  assert.deepEqual(
    (await reader.list({ q: `#${HUGE_ID}`, filter: 'pending' })).items.map(item => item.id),
    [HUGE_ID],
  );
});

test('manual salary, partial pair fallback, dates, and artifact flags are safe projections', async () => {
  const { reader } = readerFor();
  const result = await reader.list({ filter: 'applied' });
  assert.equal(result.items[0].salary.min, '100000');
  assert.deepEqual(result.items[0].compensation, {
    text: '$100,000 - $140,000 (edited)',
    state: 'manual',
  });
  assert.deepEqual(result.items[0].materials, { cv: true, letter: false });
  assert.equal(result.items[0].statusDate, '2026-01-02');
  assert.equal(Object.hasOwn(result.items[0], 'notes'), false);
  assert.equal(Object.hasOwn(result.items[0], 'report_path'), false);
});

test('signed offset cursors page, go backward, reject tampering/query mismatch and stale offsets', async () => {
  const { reader } = readerFor();
  const first = await reader.list({ limit: '2' });
  assert.ok(first.nextCursor);
  assert.equal(first.previousCursor, null);
  const second = await reader.list({ limit: '2', cursor: first.nextCursor });
  assert.ok(second.previousCursor);
  const previous = await reader.list({ limit: '2', cursor: second.previousCursor });
  assert.deepEqual(
    previous.items.map(item => item.id),
    first.items.map(item => item.id),
  );
  await assert.rejects(reader.list({ limit: '2', filter: 'applied', cursor: first.nextCursor }), {
    publicCode: 'INVALID_REQUEST',
  });
  await assert.rejects(reader.list({ limit: '2', cursor: `${first.nextCursor}x` }), {
    publicCode: 'INVALID_REQUEST',
  });
  const staleReader = readerFor(dataRows.slice(0, 1)).reader;
  await assert.rejects(staleReader.list({ limit: '2', cursor: first.nextCursor }), {
    publicCode: 'INVALID_REQUEST',
  });
  const restartedReader = createJobsReader({
    query: async () => dataRows,
    resolveMaterials: async () => new Map(),
    readCompensation: async () => ({ text: null, state: 'missing' }),
    cursorKey: Buffer.alloc(32, 8),
  });
  const restartedCursor = (await restartedReader.list({ limit: '2' })).nextCursor;
  await assert.rejects(reader.list({ limit: '2', cursor: restartedCursor }), {
    publicCode: 'INVALID_REQUEST',
  });
});

test('sort keeps nulls last and bigint ties ascending; secondary date remains newest-first', async () => {
  const rows = [
    row('9007199254740993', 'Evaluated', { score: null, source_date: null, status_date: null }),
    row('9007199254740992', 'Evaluated', { score: null, source_date: null, status_date: null }),
    row('10', 'Evaluated', { score: '3', source_date: '2026-01-01', status_date: '2026-01-01' }),
    row('11', 'Evaluated', { score: '3', source_date: '2026-01-02', status_date: '2026-01-02' }),
  ];
  const { reader } = readerFor(rows);
  assert.deepEqual(
    (await reader.list({ filter: 'evaluated', sort: 'score' })).items.map(item => item.id),
    ['10', '11', '9007199254740992', '9007199254740993'],
  );
  assert.deepEqual(
    (await reader.list({ filter: 'evaluated', sort: 'statusDate', direction: 'asc' })).items.map(
      item => item.id,
    ),
    ['10', '11', '9007199254740992', '9007199254740993'],
  );
});

test('overview matches Go status, funnel, pending score buckets and zero denominator behavior', async () => {
  const { reader, calls } = readerFor();
  const overview = await reader.overview();
  assert.equal(calls.length, 1);
  assert.deepEqual(overview.metrics.byStatus, {
    Evaluated: 1,
    Applied: 1,
    Interview: 1,
    Offer: 1,
    Rejected: 1,
    Discarded: 1,
    Ghosted: 1,
  });
  assert.equal(overview.metrics.total, 7);
  assert.equal(overview.progress.funnel[0].percent, 100);
  assert.equal(overview.progress.scoreBuckets[0].count, 3);
  assert.equal(overview.progress.funnel[3].count, 3);
  const empty = readerFor([]).reader;
  const emptyOverview = await empty.overview();
  assert.equal(emptyOverview.progress.funnel[0].percent, 100);
  assert.equal(emptyOverview.progress.responseRate, 0);
  assert.equal(emptyOverview.metrics.avgScore, null);
});

test('artifact resolver prefers one exact ID folder, rejects duplicate IDs, and supports legacy fallback', async () => {
  await withOwnedTemp(async root => {
    const exact = join(root, 'output', 'Example', 'Engineer--900719925474099312345');
    const duplicate = join(root, 'output', 'Other', 'Engineer--900719925474099312345');
    const legacy = join(root, 'output', 'Example', 'data-engineer');
    await mkdir(exact, { recursive: true });
    await mkdir(duplicate, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(join(exact, 'cv-final.pdf'), 'synthetic');
    await writeFile(join(duplicate, 'cover-letter.pdf'), 'synthetic');
    await writeFile(join(legacy, 'cover-letter-brief.md'), 'synthetic');
    const result = await resolveJobMaterials(
      [
        row(HUGE_ID, 'Evaluated', { company: 'Example', role: 'Engineer' }),
        row('22', 'Evaluated', { company: 'Example', role: 'Data Engineer' }),
      ],
      root,
    );
    assert.deepEqual(result.get(HUGE_ID), { cv: false, letter: false });
    assert.deepEqual(result.get('22'), { cv: false, letter: true });
  });
});

test('compensation projection stays inside allowed roots and distinguishes band, unknown, missing and unsafe', async () => {
  await withOwnedTemp(async root => {
    const reports = join(root, 'data', 'evaluations');
    await mkdir(reports, { recursive: true });
    await writeFile(join(reports, 'band.md'), '**Compensation band:** CAD 100k–140k\n');
    await writeFile(
      join(reports, 'unknown.md'),
      '**Compensation band:** UNKNOWN — JD lists no band\n',
    );
    assert.deepEqual(
      await readReportCompensation({ report_path: 'data/evaluations/band.md' }, root),
      {
        text: 'CAD 100k–140k',
        state: 'report',
      },
    );
    assert.deepEqual(
      await readReportCompensation({ report_path: 'data/evaluations/unknown.md' }, root),
      {
        text: null,
        state: 'missing',
      },
    );
    assert.deepEqual(
      await readReportCompensation({ report_path: 'data/evaluations/missing.md' }, root),
      {
        text: null,
        state: 'missing',
      },
    );
    assert.deepEqual(await readReportCompensation({ report_path: '../outside.md' }, root), {
      text: null,
      state: 'invalid',
    });
    assert.deepEqual(await readReportCompensation({ report_path: 'config/private.md' }, root), {
      text: null,
      state: 'invalid',
    });
  });
});

test('D061 score, week and any filters normalize strictly and omit unset fields', () => {
  const ok = normalizeJobsQuery({ scoreMin: '3.5', scoreMax: 4, addedWeek: '2026-W01' }).query;
  assert.equal(ok.scoreMin, 3.5);
  assert.equal(ok.scoreMax, 4);
  assert.equal(ok.addedWeek, '2026-W01');
  assert.equal(normalizeJobsQuery({ filter: 'any' }).query.filter, 'any');
  const bare = normalizeJobsQuery({}).query;
  for (const field of ['scoreMin', 'scoreMax', 'addedWeek']) assert.equal(field in bare, false);
  assert.equal(normalizeJobsQuery({ scoreMin: '0', scoreMax: '5' }).query.scoreMax, 5);
  for (const [raw, field] of [
    [{ scoreMin: '5.1' }, 'scoreMin'],
    [{ scoreMin: '3.55' }, 'scoreMin'],
    [{ scoreMin: '-1' }, 'scoreMin'],
    [{ scoreMin: 'abc' }, 'scoreMin'],
    [{ scoreMin: '' }, 'scoreMin'],
    [{ scoreMax: 6 }, 'scoreMax'],
    [{ scoreMax: 3.55 }, 'scoreMax'],
    [{ scoreMin: '4', scoreMax: '3' }, 'scoreMax'],
    [{ addedWeek: '2026-W54' }, 'addedWeek'],
    [{ addedWeek: '2026-W00' }, 'addedWeek'],
    [{ addedWeek: '2026-01-01' }, 'addedWeek'],
    [{ addedWeek: 202601 }, 'addedWeek'],
  ])
    assert.throws(
      () => normalizeJobsQuery(raw),
      error => error.publicCode === 'INVALID_REQUEST' && field in error.fields,
      JSON.stringify(raw),
    );
});

test('D061 score bounds only match positive scores; bounds are min-inclusive, max-exclusive', async () => {
  const { reader } = readerFor();
  const ids = async q => (await reader.list({ filter: 'any', ...q })).items.map(i => i.id).sort();
  assert.deepEqual(await ids({ scoreMin: '4' }), ['2', '4', '5', '8', HUGE_ID].sort());
  assert.deepEqual(await ids({ scoreMin: '4', scoreMax: '4.5' }), ['2', '8']);
  assert.deepEqual(await ids({ scoreMax: '3.5' }), ['6']);
  const zero = [
    row('1', 'Evaluated', { score: '0' }),
    row('2', 'Evaluated', { score: null }),
    row('3', 'Evaluated', { score: '2.0' }),
  ];
  const zeroReader = readerFor(zero).reader;
  assert.deepEqual(
    (await zeroReader.list({ filter: 'any', scoreMax: '5' })).items.map(i => i.id),
    ['3'],
  );
  assert.equal((await zeroReader.list({ filter: 'any' })).totalCount, 3);
});

test('D061 addedWeek matches the ISO week used by weeklyActivity; any includes Pending', async () => {
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2024-12-30'), '2025-W01');
  assert.equal(isoWeekKey('nope'), null);
  const rows = [
    row('1', 'Evaluated', { source_date: '2026-01-05' }),
    row('2', 'Pending', { source_date: '2026-01-06' }),
    row('3', 'Evaluated', { source_date: null, first_seen: '2026-01-11' }),
    row('4', 'Evaluated', { source_date: '2026-01-12' }),
  ];
  const { reader } = readerFor(rows);
  const week = async q => (await reader.list(q)).items.map(i => i.id).sort();
  assert.deepEqual(await week({ filter: 'any', addedWeek: '2026-W02' }), ['1', '2', '3']);
  assert.deepEqual(await week({ addedWeek: '2026-W02' }), ['1', '3']);
  assert.deepEqual(await week({ filter: 'pending' }), ['2']);
  const overview = await reader.overview();
  const weeks = Object.fromEntries(overview.progress.weeklyActivity.map(w => [w.week, w.count]));
  assert.equal(weeks['2026-W02'], 3);
  assert.equal(weeks['2026-W03'], 1);
  const echoed = (await reader.list({ filter: 'any', scoreMin: '1', addedWeek: '2026-W02' })).query;
  assert.equal(echoed.scoreMin, 1);
  assert.equal(echoed.addedWeek, '2026-W02');
  assert.equal('scoreMax' in echoed, false);
});

test('D061 cursors are bound to the new filter fields', async () => {
  const { reader } = readerFor();
  const first = await reader.list({ filter: 'any', limit: '2', scoreMin: '3' });
  assert.ok(first.nextCursor);
  await reader.list({ filter: 'any', limit: '2', scoreMin: '3', cursor: first.nextCursor });
  for (const other of [
    { scoreMin: '3.5' },
    { scoreMax: '5' },
    { scoreMin: '3', addedWeek: '2026-W01' },
    {},
  ])
    await assert.rejects(
      reader.list({ filter: 'any', limit: '2', ...other, cursor: first.nextCursor }),
      { publicCode: 'INVALID_REQUEST' },
    );
  await assert.rejects(
    reader.list({ filter: 'all', limit: '2', scoreMin: '3', cursor: first.nextCursor }),
    { publicCode: 'INVALID_REQUEST' },
  );
});

test('D114 favorite flag: projected, filters with the other filters, and echoed only when set', async () => {
  const rows = [
    row('1', 'Evaluated', { score: '2.0', favorite: true, notes: 'keep' }),
    row('2', 'Evaluated', { score: '4.5' }),
    row('3', 'Applied', { score: '1.0', favorite: true }),
    row('4', 'Evaluated', { score: '3.0', favorite: true }),
  ];
  const { reader } = readerFor(rows);
  const all = await reader.list({ filter: 'any' });
  assert.deepEqual(
    all.items.map(item => [item.id, item.favorite]),
    [
      ['3', true],
      ['2', false],
      ['4', true],
      ['1', true],
    ],
  );
  assert.equal('favorite' in all.query, false);
  const only = await reader.list({ filter: 'any', favorite: 'true' });
  assert.deepEqual(
    only.items.map(item => item.id),
    ['3', '4', '1'],
  );
  assert.equal(only.query.favorite, true);
  assert.deepEqual(
    (await reader.list({ filter: 'evaluated', favorite: 'true', q: 'keep' })).items.map(
      item => item.id,
    ),
    ['1'],
  );
  for (const bad of ['false', '1', '', 'yes'])
    assert.throws(() => normalizeJobsQuery({ favorite: bad }), { publicCode: 'INVALID_REQUEST' });
});

test('D114 sort=favorite puts favorites first, default order inside each group, and pages stably', async () => {
  const rows = [
    row('1', 'Evaluated', { score: '2.0', favorite: true }),
    row('2', 'Evaluated', { score: '4.5' }),
    row('3', 'Evaluated', { score: '1.0', favorite: true }),
    row('4', 'Evaluated', { score: '3.0' }),
    row('5', 'Evaluated', { score: '3.5', favorite: true }),
  ];
  const { reader } = readerFor(rows);
  const base = { filter: 'any', sort: 'favorite' };
  const ids = result => result.items.map(item => item.id);
  assert.deepEqual(ids(await reader.list(base)), ['5', '1', '3', '2', '4']);
  assert.deepEqual(ids(await reader.list({ ...base, direction: 'asc' })), [
    '2',
    '4',
    '5',
    '1',
    '3',
  ]);
  const first = await reader.list({ ...base, limit: '2' });
  const second = await reader.list({ ...base, limit: '2', cursor: first.nextCursor });
  const third = await reader.list({ ...base, limit: '2', cursor: second.nextCursor });
  assert.deepEqual([...ids(first), ...ids(second), ...ids(third)], ['5', '1', '3', '2', '4']);
  assert.equal(third.nextCursor, null);
  // The cursor is bound to the sort.
  await assert.rejects(
    reader.list({ filter: 'any', sort: 'score', limit: '2', cursor: first.nextCursor }),
    { publicCode: 'INVALID_REQUEST' },
  );
});

test('D115 boolean q: legacy plain text is unchanged, operators combine, errors name the problem', async () => {
  const rows = [
    row('1', 'Evaluated', { company: 'Acme', role: 'Senior Security Engineer', score: '4' }),
    row('2', 'Evaluated', { company: 'Beta', role: 'Security AI Engineer', score: '3' }),
    row('3', 'Evaluated', { company: 'Gamma', role: 'Data Engineer', notes: '100%_x', score: '2' }),
  ];
  const { reader, calls } = readerFor(rows);
  const ids = async q =>
    (await reader.list({ filter: 'any', q, grouped: 'false' })).items.map(item => item.id);
  // Legacy path: the same single read query, whole string as one needle, wildcards literal.
  assert.deepEqual(await ids('security engineer'), ['1']);
  assert.deepEqual(await ids('100%_x'), ['3']);
  assert.deepEqual(await ids('%'), ['3']);
  assert.deepEqual(await ids('security and engineer'), [], 'lowercase and is an ordinary word');
  assert.ok(
    calls.every(sql => sql === calls[0]),
    'one unchanged SELECT for every search',
  );
  // Boolean path.
  assert.deepEqual(await ids('security AND AI'), ['2']);
  assert.deepEqual(await ids('("security" AND "ai") OR data'), ['2', '3']);
  assert.deepEqual(await ids('NOT "senior"'), ['2', '3']);
  assert.deepEqual(await ids('engineer NOT security'), ['3']);
  assert.deepEqual(await ids('"100%_x"'), ['3']);
  // Counts, paging, filter and favorite keep working with a boolean q.
  const page = await reader.list({ filter: 'any', q: 'engineer OR NOT zzz', limit: '2' });
  assert.equal(page.totalCount, 3);
  assert.ok(page.nextCursor);
  const next = await reader.list({
    filter: 'any',
    q: 'engineer OR NOT zzz',
    limit: '2',
    cursor: page.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.equal((await reader.list({ filter: 'pending', q: 'NOT zzz' })).totalCount, 0);
  // Invalid expressions are a 400 with a q field message.
  await assert.rejects(reader.list({ q: '(security' }), error => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.publicCode, 'INVALID_REQUEST');
    assert.deepEqual(error.fields, { q: 'Missing closing parenthesis.' });
    return true;
  });
  assert.throws(() => normalizeJobsQuery({ q: 'a AND' }), {
    fields: { q: 'AND needs a search term after it.' },
  });
});

test('D116 years of experience: item fields, yoeMax, yoeUnknown, sort=yoe and stable paging', async () => {
  const rows = [
    row('1', 'Evaluated', { score: '4', yoe_min: 5, yoe_confidence: 'high' }),
    row('2', 'Evaluated', { score: '3', yoe_min: null, yoe_confidence: null }),
    row('3', 'Evaluated', { score: '2', yoe_min: 2, yoe_confidence: 'inferred' }),
    row('4', 'Evaluated', { score: '1', yoe_min: 0, yoe_confidence: 'low' }),
    row('5', 'Evaluated', { score: '5', yoe_min: 8, yoe_confidence: 'medium' }),
  ];
  const { reader } = readerFor(rows);
  const ids = result => result.items.map(item => item.id);
  const all = await reader.list({ filter: 'any' });
  assert.deepEqual(
    all.items.map(item => [item.id, item.yoeMin, item.yoeConfidence]),
    [
      ['5', 8, 'medium'],
      ['1', 5, 'high'],
      ['2', null, null],
      ['3', 2, 'inferred'],
      ['4', 0, 'low'],
    ],
  );
  for (const key of ['yoeMax', 'yoeUnknown', 'posting']) assert.equal(key in all.query, false);
  // yoeMax keeps jobs at or under N and jobs with no estimate.
  assert.deepEqual(ids(await reader.list({ filter: 'any', yoeMax: '5' })).sort(), [
    '1',
    '2',
    '3',
    '4',
  ]);
  assert.deepEqual(ids(await reader.list({ filter: 'any', yoeMax: 0 })).sort(), ['2', '4']);
  assert.equal((await reader.list({ filter: 'any', yoeMax: '5' })).query.yoeMax, 5);
  assert.deepEqual(
    ids(await reader.list({ filter: 'any', yoeMax: '5', yoeUnknown: 'exclude' })).sort(),
    ['1', '3', '4'],
  );
  // sort=yoe: ascending by default, no estimate last in both directions, then id.
  const base = { filter: 'any', sort: 'yoe', grouped: 'false' };
  assert.deepEqual(ids(await reader.list(base)), ['4', '3', '1', '5', '2']);
  assert.deepEqual(ids(await reader.list({ ...base, direction: 'desc' })), [
    '5',
    '1',
    '3',
    '4',
    '2',
  ]);
  const first = await reader.list({ ...base, limit: '2' });
  const second = await reader.list({ ...base, limit: '2', cursor: first.nextCursor });
  const third = await reader.list({ ...base, limit: '2', cursor: second.nextCursor });
  assert.deepEqual([...ids(first), ...ids(second), ...ids(third)], ['4', '3', '1', '5', '2']);
  assert.equal(third.nextCursor, null);
  // The cursor is bound to the filter too.
  await assert.rejects(
    reader.list({ ...base, yoeMax: '5', limit: '2', cursor: first.nextCursor }),
    {
      publicCode: 'INVALID_REQUEST',
    },
  );
  for (const bad of ['-1', '41', '1.5', 'x', '', true, [1]])
    assert.throws(() => normalizeJobsQuery({ yoeMax: bad }), { publicCode: 'INVALID_REQUEST' });
  for (const bad of ['include', true, '', 'true'])
    assert.throws(() => normalizeJobsQuery({ yoeUnknown: bad }), { publicCode: 'INVALID_REQUEST' });
});

test('D117 posting: latest check on the item, posting=expired and posting=applied-closed', async () => {
  const check = (state, action) => ({
    posting_state: state,
    posting_action: action,
    posting_checked_at: '2026-11-15T06:00:00Z',
  });
  const rows = [
    row('1', 'Discarded', check('closed', 'discarded')),
    row('2', 'Discarded', check('open', 'none')),
    row('3', 'Applied', check('probably_closed', 'flagged')),
    row('4', 'Applied', check('open', 'none')),
    row('5', 'Applied', check('closed', 'flagged')),
    row('6', 'Evaluated', check('closed', 'discarded')),
    row('7', 'Applied'),
  ];
  const { reader } = readerFor(rows);
  const ids = async posting =>
    (await reader.list({ filter: 'any', posting, grouped: 'false' })).items.map(item => item.id);
  assert.deepEqual(await ids('expired'), ['1']);
  assert.deepEqual((await ids('applied-closed')).sort(), ['3', '5']);
  const all = await reader.list({ filter: 'any', grouped: 'false' });
  const byId = new Map(all.items.map(item => [item.id, item.posting]));
  assert.deepEqual(byId.get('1'), {
    state: 'closed',
    action: 'discarded',
    checkedAt: '2026-11-15T06:00:00Z',
  });
  assert.equal(byId.get('7'), null);
  assert.equal((await reader.list({ filter: 'any', posting: 'expired' })).query.posting, 'expired');
  for (const bad of ['open', 'true', '', true])
    assert.throws(() => normalizeJobsQuery({ posting: bad }), { publicCode: 'INVALID_REQUEST' });
});
