import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobsReader, normalizeJobsQuery } from './jobs-read.mjs';
import { resolveJobMaterials } from './jobs-materials.mjs';
import { readReportCompensation } from './jobs-compensation.mjs';
import { mkdtemp, mkdir, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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
