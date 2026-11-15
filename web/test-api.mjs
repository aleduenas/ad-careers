import { createApi, ApiFailure } from './src/api.ts';
import assert from 'node:assert/strict';
import {
  commentRoom,
  discardProblem,
  discardReasonText,
  DISCARD_REASON_LIMIT,
  NO_REASON,
  visibleDiscardReason,
} from './src/lib/discard.ts';
import test from 'node:test';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('client reads only the contracted endpoints with GET and an abort signal', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const data = url.endsWith('/health')
      ? { status: 'ok' }
      : url.endsWith('/ready')
        ? {
            ready: true,
            database: 'ready',
            schema: 'ready',
            taskDispatch: { ready: false, reason: 'notImplemented' },
          }
        : {
            apiVersion: '1',
            nonce: 'synthetic-only',
            capabilities: { jobReads: false, taskDispatch: false },
          };
    return response(200, {
      data,
      meta: { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' },
    });
  };
  const signal = new AbortController().signal;
  const client = createApi(fetcher);
  await Promise.all([client.health(signal), client.ready(signal), client.session(signal)]);
  assert.deepEqual(calls.map(call => call.url).sort(), [
    '/api/v1/health',
    '/api/v1/ready',
    '/api/v1/session',
  ]);
  assert.ok(calls.every(call => call.options.method === 'GET' && call.options.signal === signal));
  assert.ok(calls.every(call => call.options.headers.Accept === 'application/json'));
});

test('client preserves database and schema errors from the server envelope', async () => {
  for (const [code, message, retryable] of [
    ['DATABASE_UNAVAILABLE', 'Database is unavailable.', true],
    ['SCHEMA_NOT_READY', 'Required database schema is not ready.', false],
  ]) {
    const client = createApi(async () =>
      response(503, { error: { code, message, requestId: 'req-synthetic', retryable } }),
    );
    await assert.rejects(client.ready(new AbortController().signal), error => {
      assert.ok(error instanceof ApiFailure);
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      assert.equal(error.requestId, 'req-synthetic');
      assert.equal(error.retryable, retryable);
      return true;
    });
  }
});

test('network and invalid response failures stay actionable and sanitized', async () => {
  const client = createApi(async () => {
    throw new Error('private transport detail');
  });
  await assert.rejects(client.health(new AbortController().signal), error => {
    assert.ok(error instanceof ApiFailure);
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.retryable, true);
    assert.equal(error.message, 'The local service could not be reached.');
    assert.equal(error.network, true);
    return true;
  });
  const malformed = createApi(
    async () =>
      new Response('not json', { status: 503, headers: { 'content-type': 'application/json' } }),
  );
  await assert.rejects(malformed.ready(new AbortController().signal), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.message, 'The local service returned an unexpected response.');
    return true;
  });
  const primitiveError = createApi(async () => response(503, 'unstructured detail'));
  await assert.rejects(primitiveError.ready(new AbortController().signal), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.message, 'The local service returned an unexpected response.');
    return true;
  });
  const incompleteError = createApi(async () =>
    response(503, { error: { code: 'UNAVAILABLE', message: 'Unavailable', retryable: true } }),
  );
  await assert.rejects(incompleteError.ready(new AbortController().signal), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
  const malformedSuccess = createApi(async () => response(200, { data: null, meta: {} }));
  await assert.rejects(malformedSuccess.health(new AbortController().signal), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
  const proxyUnavailable = createApi(
    async () => new Response('proxy unavailable', { status: 500 }),
  );
  await assert.rejects(proxyUnavailable.health(new AbortController().signal), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.network, true);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('aborts propagate without being reported as a network error', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createApi(async (_url, options) => {
    throw options.signal.reason;
  });
  await assert.rejects(client.session(controller.signal), error => !(error instanceof ApiFailure));
});

function syntheticJob(overrides = {}) {
  return {
    id: '9007199254740993',
    revision: '0',
    company: 'Synthetic Company',
    role: 'Synthetic Role',
    url: null,
    status: 'Evaluated',
    score: 4,
    addedDate: '2026-10-01',
    statusDate: null,
    discardReason: null,
    salary: null,
    compensation: { text: 'Not assessed', state: 'missing' },
    materials: { cv: true, letter: false },
    ...overrides,
  };
}

function syntheticOverview() {
  return {
    label: 'inferredFromCurrentState',
    metrics: {
      total: 1,
      actionable: 1,
      byStatus: {
        Evaluated: 1,
        Applied: 0,
        Interview: 0,
        Offer: 0,
        Rejected: 0,
        Discarded: 0,
        Ghosted: 0,
      },
      avgScore: 4,
      topScore: 4,
    },
    progress: {
      funnel: [
        { label: 'Evaluated', count: 1, percent: 100 },
        { label: 'Applied', count: 0, percent: 0 },
        { label: 'Responded', count: 0, percent: 0 },
        { label: 'Interview', count: 0, percent: 0 },
        { label: 'Offer', count: 0, percent: 0 },
      ],
      responseRate: 0,
      interviewRate: 0,
      offerRate: 0,
      scoreBuckets: [
        { label: '4.5-5.0', count: 0 },
        { label: '4.0-4.4', count: 1 },
        { label: '3.5-3.9', count: 0 },
        { label: '3.0-3.4', count: 0 },
        { label: '  <3.0', count: 0 },
      ],
      weeklyActivity: [{ week: '2026-W40', count: 1 }],
    },
  };
}

test('jobs reader sends the frozen query and cursor and accepts decimal bigint strings', async () => {
  const calls = [];
  const client = createApi(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(200, {
      data: {
        items: [syntheticJob()],
        totalCount: 7,
        nextCursor: 'opaque-next-token',
        previousCursor: null,
        query: {
          q: 'école',
          filter: 'offer',
          sort: 'company',
          direction: 'asc',
          grouped: false,
          limit: 25,
        },
      },
      meta: { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' },
    });
  });
  const query = {
    q: 'école',
    filter: 'offer',
    sort: 'company',
    direction: 'asc',
    grouped: false,
    limit: 25,
  };
  const signal = new AbortController().signal;
  const result = await client.jobs(query, 'opaque-current-token', signal);
  const params = new URL(calls[0].url, 'http://local').searchParams;
  assert.equal(params.get('q'), 'école');
  assert.equal(params.get('filter'), 'offer');
  assert.equal(params.get('sort'), 'company');
  assert.equal(params.get('direction'), 'asc');
  assert.equal(params.get('grouped'), 'false');
  assert.equal(params.get('limit'), '25');
  assert.equal(params.get('cursor'), 'opaque-current-token');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.signal, signal);
  assert.equal(result.data.items[0].id, '9007199254740993');
  assert.equal(result.data.items[0].statusDate, null);
});

test('jobs and overview responses are guarded against malformed payloads', async () => {
  const envelope = data => ({
    data,
    meta: { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' },
  });
  const validJobs = {
    items: [syntheticJob()],
    totalCount: 1,
    nextCursor: null,
    previousCursor: null,
    query: { q: '', filter: 'all', sort: 'score', direction: 'desc', grouped: true, limit: 50 },
  };
  const badJob = { ...syntheticJob(), id: 9007199254740993 };
  for (const [kind, resultBody] of [
    ['bad bigint', envelope({ ...validJobs, items: [badJob] })],
    ['too many code points', envelope({ ...validJobs, query: { ...validJobs.query, q: 'é'.repeat(201) } })],
  ]) {
    const client = createApi(async () => response(200, resultBody));
    await assert.rejects(
      client.jobs(validJobs.query, null, new AbortController().signal),
      error => error.code === 'INVALID_RESPONSE',
      kind,
    );
  }
  const overviewClient = createApi(async () => response(200, envelope(syntheticOverview())));
  assert.equal((await overviewClient.overview(new AbortController().signal)).data.metrics.total, 1);
  const malformedOverview = syntheticOverview();
  malformedOverview.progress.funnel[0].percent = 101;
  const invalidOverviewClient = createApi(async () => response(200, envelope(malformedOverview)));
  await assert.rejects(
    invalidOverviewClient.overview(new AbortController().signal),
    error => error.code === 'INVALID_RESPONSE',
  );
});

test('jobs reader accepts the favorite, years-of-experience and posting-check shapes', async () => {
  const envelope = data => ({
    data,
    meta: { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' },
  });
  const checkedAt = '2026-11-15T06:00:00Z';
  for (const query of [
    { q: '', filter: 'all', sort: 'favorite', direction: 'desc', grouped: true, limit: 50, favorite: true },
    { q: '', filter: 'all', sort: 'yoe', direction: 'asc', grouped: false, limit: 50, yoeMax: 5, yoeUnknown: 'exclude', posting: 'expired' },
  ]) {
    const body = envelope({
      items: [
        syntheticJob({ favorite: true, yoeMin: 3, yoeConfidence: 'inferred', posting: { state: 'open', action: 'none', checkedAt } }),
        syntheticJob({ id: '12', favorite: false, yoeMin: null, yoeConfidence: null, posting: null }),
      ],
      totalCount: 2,
      nextCursor: null,
      previousCursor: null,
      query,
    });
    const result = await createApi(async () => response(200, body)).jobs(query, null, new AbortController().signal);
    assert.equal(result.data.query.sort, query.sort);
  }
  const bad = [
    ['unknown sort', { sort: 'nope' }],
    ['bad yoe flag', { yoeUnknown: 'include' }],
  ];
  for (const [kind, patch] of bad) {
    const query = { q: '', filter: 'all', sort: 'score', direction: 'desc', grouped: true, limit: 50, ...patch };
    const body = envelope({ items: [syntheticJob()], totalCount: 1, nextCursor: null, previousCursor: null, query });
    await assert.rejects(
      createApi(async () => response(200, body)).jobs(query, null, new AbortController().signal),
      error => error.code === 'INVALID_RESPONSE',
      kind,
    );
  }
  const badPosting = envelope({
    items: [syntheticJob({ posting: { state: 'gone', action: 'none', checkedAt } })],
    totalCount: 1,
    nextCursor: null,
    previousCursor: null,
    query: { q: '', filter: 'all', sort: 'score', direction: 'desc', grouped: true, limit: 50 },
  });
  await assert.rejects(
    createApi(async () => response(200, badPosting)).jobs(badPosting.data.query, null, new AbortController().signal),
    error => error.code === 'INVALID_RESPONSE',
  );
});

test('runs reader accepts a posting check run', async () => {
  const run = {
    id: '00000000-0000-4000-8000-000000000001',
    requestKey: 'k',
    groupId: null,
    action: 'liveness',
    jobId: null,
    state: 'completed',
    phase: 'done',
    attempt: 1,
    exitCode: 0,
    errorCode: null,
    createdAt: '2026-11-15T06:00:00Z',
    startedAt: null,
    updatedAt: '2026-11-15T06:00:00Z',
    finishedAt: null,
    selection: null,
    source: 'browser',
  };
  const body = { data: { runs: [run] }, meta: { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' } };
  const result = await createApi(async () => response(200, body)).runs(new AbortController().signal);
  assert.equal(result.data.runs[0].action, 'liveness');
});

test('posting check calls: summary guard, start body and the jobs query parameters', async () => {
  const meta = { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' };
  const last = {
    finishedAt: '2026-11-15T06:00:00Z',
    checked: 10,
    open: 6,
    closed: 2,
    probablyClosed: 1,
    unknown: 1,
    discarded: 2,
    flagged: 1,
    heldBack: 0,
  };
  for (const lastFullCheck of [null, last]) {
    const client = createApi(async () => response(200, { data: { running: false, lastFullCheck }, meta }));
    const result = await client.livenessSummary(new AbortController().signal);
    assert.deepEqual(result.data.lastFullCheck, lastFullCheck);
  }
  for (const bad of [{ running: 'no', lastFullCheck: null }, { running: false, lastFullCheck: { ...last, open: -1 } }, { running: false }]) {
    await assert.rejects(
      createApi(async () => response(200, { data: bad, meta })).livenessSummary(new AbortController().signal),
      error => error.code === 'INVALID_RESPONSE',
    );
  }
  const calls = [];
  const run = {
    id: '00000000-0000-4000-8000-000000000002', requestKey: 'k', groupId: null, action: 'liveness', jobId: '12',
    state: 'queued', phase: 'queued', attempt: 1, exitCode: null, errorCode: null, createdAt: '2026-11-15T06:00:00Z',
    startedAt: null, updatedAt: '2026-11-15T06:00:00Z', finishedAt: null, selection: null, source: 'browser',
  };
  const client = createApi(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(String(url).includes('/runs') ? 201 : 200, String(url).includes('/runs')
      ? { data: { runs: [run] }, meta }
      : { data: { items: [], totalCount: 0, nextCursor: null, previousCursor: null, query: { q: '', filter: 'all', sort: 'yoe', direction: 'asc', grouped: true, limit: 50, yoeMax: 5, yoeUnknown: 'exclude', posting: 'expired' } }, meta });
  });
  await client.startLiveness({ action: 'liveness', requestKey: 'k', jobId: '12' }, 'nonce-value', new AbortController().signal);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['x-career-ops-session'], 'nonce-value');
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'liveness', requestKey: 'k', jobId: '12' });
  await client.jobs({ q: '', filter: 'all', sort: 'yoe', direction: 'asc', grouped: true, limit: 50, yoeMax: 5, yoeUnknown: 'exclude', posting: 'expired' }, null, new AbortController().signal);
  const params = new URL(calls[1].url, 'http://x').searchParams;
  assert.equal(params.get('yoeMax'), '5');
  assert.equal(params.get('yoeUnknown'), 'exclude');
  assert.equal(params.get('posting'), 'expired');
  await client.jobs({ q: '', filter: 'all', sort: 'score', direction: 'desc', grouped: true, limit: 50, yoeUnknown: 'exclude' }, null, new AbortController().signal);
  const loose = new URL(calls[2].url, 'http://x').searchParams;
  assert.equal(loose.has('yoeUnknown'), false, 'the no-estimate flag is only sent with a limit');
});

test('discard reason text: none, reason, comment, both, and the server length cap', () => {
  assert.equal(discardReasonText(null, ''), 'No reason given');
  assert.equal(discardReasonText(null, '   '), NO_REASON);
  assert.equal(discardReasonText('Expired', ''), 'Expired');
  assert.equal(discardReasonText(null, ' Staff level '), 'Staff level');
  assert.equal(discardReasonText('Title mismatch', 'Staff level'), 'Title mismatch: Staff level');
  // The comment room leaves space for "Reason: " so the joined text is at most the server limit.
  const reason = 'Seniority mismatch';
  const room = commentRoom(reason);
  assert.equal(room, DISCARD_REASON_LIMIT - reason.length - 2);
  assert.equal(discardReasonText(reason, 'x'.repeat(room)).length, DISCARD_REASON_LIMIT);
  assert.equal(discardProblem(reason, 'x'.repeat(room)), undefined);
  assert.match(discardProblem(reason, 'x'.repeat(room + 1)), /1 characters too long/);
  assert.equal(commentRoom(null), DISCARD_REASON_LIMIT);
  assert.equal(discardProblem(null, 'x'.repeat(DISCARD_REASON_LIMIT)), undefined);
  // A job discarded without a reason shows just "Discarded".
  assert.equal(visibleDiscardReason(NO_REASON), null);
  assert.equal(visibleDiscardReason(null), null);
  assert.equal(visibleDiscardReason('Expired'), 'Expired');
});

test('location review: the evaluate request carries locationConfirmed and runs may carry a short detail', async () => {
  const meta = { requestId: 'synthetic', observedAt: '2026-01-01T00:00:00Z' };
  const run = {
    id: '00000000-0000-4000-8000-000000000003', requestKey: 'k', groupId: null, action: 'evaluate', jobId: '12',
    state: 'failed', phase: 'done', attempt: 1, exitCode: 2, errorCode: 'LOCATION_REVIEW',
    createdAt: '2026-11-15T06:00:00Z', startedAt: null, updatedAt: '2026-11-15T06:00:00Z', finishedAt: null,
    selection: null, source: 'browser', detail: 'The posting lists three offices and none is in Canada.',
  };
  const calls = [];
  const client = createApi(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(options.method === 'POST' ? 201 : 200, { data: { runs: [run] }, meta });
  });
  await client.startJobRun(
    { action: 'evaluate', jobId: '12', requestKey: 'job-evaluate-12-x', locationConfirmed: true },
    'nonce-value',
    new AbortController().signal,
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: 'evaluate',
    jobId: '12',
    requestKey: 'job-evaluate-12-x',
    locationConfirmed: true,
  });
  const listed = await client.runs(new AbortController().signal, '12');
  assert.equal(listed.data.runs[0].detail, run.detail);
  for (const detail of ['x'.repeat(301), 5]) {
    await assert.rejects(
      createApi(async () => response(200, { data: { runs: [{ ...run, detail }] }, meta })).runs(new AbortController().signal),
      error => error.code === 'INVALID_RESPONSE',
    );
  }
  const plain = { ...run };
  delete plain.detail;
  const old = await createApi(async () => response(200, { data: { runs: [plain] }, meta })).runs(new AbortController().signal);
  assert.equal(old.data.runs[0].detail, undefined, 'older runs have no detail');
});

test('safe cursor validation details survive without exposing untrusted errors', async () => {
  const client = createApi(async () =>
    response(400, {
      error: {
        code: 'INVALID_REQUEST',
        message: 'The page token is invalid.',
        requestId: 'synthetic-request',
        fields: { cursor: 'Restart this page.' },
        retryable: false,
      },
    }),
  );
  await assert.rejects(client.jobs({
    q: '', filter: 'all', sort: 'score', direction: 'desc', grouped: true, limit: 50,
  }, 'stale-token', new AbortController().signal), error => {
    assert.equal(error.code, 'INVALID_REQUEST');
    assert.equal(error.fields.cursor, 'Restart this page.');
    assert.equal(error.message, 'The page token is invalid.');
    return true;
  });
});
