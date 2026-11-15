import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createApp, requireSessionNonce } from './app.mjs';
import { createReadinessCheck } from './readiness.mjs';
import { publicSchemas } from './schemas.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const host = '127.0.0.1:4310';
const origin = `http://${host}`;

async function withApp(options, callback) {
  const app = createApp({ host, origin, ...options });
  try {
    await callback(app);
  } finally {
    await app.close();
  }
}

function injectedReader(overrides = {}) {
  return {
    list: async query => ({
      items: [],
      totalCount: 0,
      nextCursor: null,
      previousCursor: null,
      query: {
        q: query.q || '',
        filter: query.filter || 'all',
        sort: query.sort || 'score',
        direction: query.direction || 'desc',
        grouped: query.grouped !== 'false',
        limit: Number(query.limit || 50),
      },
    }),
    overview: async () => ({
      label: 'inferredFromCurrentState',
      metrics: {
        total: 0,
        actionable: 0,
        byStatus: {
          Evaluated: 0,
          Applied: 0,
          Interview: 0,
          Offer: 0,
          Rejected: 0,
          Discarded: 0,
          Ghosted: 0,
        },
        avgScore: null,
        topScore: null,
      },
      progress: {
        funnel: [
          { label: 'Evaluated', count: 0, percent: 100 },
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
          { label: '4.0-4.4', count: 0 },
          { label: '3.5-3.9', count: 0 },
          { label: '3.0-3.4', count: 0 },
          { label: '  <3.0', count: 0 },
        ],
        weeklyActivity: [],
      },
    }),
    ...overrides,
  };
}

function detailFixture(id = '7') {
  return {
    job: {
      id,
      revision: '2',
      company: 'Fixture Co',
      role: 'Role',
      url: null,
      status: 'Interview',
      score: 4.1,
      addedDate: null,
      statusDate: null,
      discardReason: null,
      favorite: false,
      yoeMin: null,
      yoeConfidence: null,
      posting: null,
      salary: null,
      compensation: { text: null, state: 'missing' },
      materials: { cv: true, letter: false },
      notes: 'note',
      evaluationError: false,
    },
    jd: null,
    actions: {
      evaluate: { enabled: false, reason: 'Only Pending or Evaluated jobs can be evaluated.' },
      cv: { enabled: true, reason: null },
      letter: { enabled: true, reason: null },
      both: { enabled: true, reason: null },
      publish: { enabled: true, reason: null },
    },
    evaluation: { report: { text: null, state: 'missing' }, history: [] },
    history: [],
    materials: {
      match: 'id',
      ambiguous: false,
      items: [
        {
          key: 'cv',
          name: 'cv-a.pdf',
          kind: 'pdf',
          size: 4,
          modifiedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    },
    interviewPrep: null,
  };
}

function publicFailure(statusCode, publicCode, fields) {
  const error = new Error('Safe public message.');
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  if (fields) error.fields = fields;
  return error;
}

function injectedDetail(overrides = {}) {
  return {
    detail: async id => detailFixture(id),
    material: async (id, key) => {
      if (key === 'cv')
        return {
          kind: 'pdf',
          name: 'cv-a.pdf',
          size: 4,
          stream: () => Readable.from([Buffer.from('%PDF')]),
        };
      return { kind: 'text', name: 'x.md', size: 5, text: '<b>hi</b>' };
    },
    ...overrides,
  };
}

function runFixture(overrides = {}) {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    requestKey: 'key-1',
    groupId: null,
    action: 'evaluate',
    jobId: '12',
    state: 'running',
    phase: 'running',
    attempt: 1,
    exitCode: null,
    errorCode: null,
    createdAt: '2026-11-10T12:00:00.000Z',
    startedAt: '2026-11-10T12:00:01.000Z',
    updatedAt: '2026-11-10T12:00:01.000Z',
    finishedAt: null,
    selection: {},
    source: 'browser',
    ...overrides,
  };
}

function injectedRuns(overrides = {}) {
  return {
    ready: async () => true,
    dispatch: async input => ({
      runs: [
        runFixture({ action: input.action, jobId: input.jobId, requestKey: input.requestKey }),
      ],
      replayed: input.requestKey === 'replay',
    }),
    list: async ({ jobId } = {}) => ({ runs: [runFixture({ jobId: jobId ?? '12' })] }),
    get: async id => ({ run: runFixture({ id }) }),
    log: async (id, { offset } = {}) => ({
      text: 'hello\n',
      offset: offset ?? 0,
      nextOffset: 6,
      size: 6,
      truncated: false,
    }),
    stop: () => {},
    ...overrides,
  };
}

function injectedWriter(overrides = {}) {
  const job = detailFixture().job;
  return {
    changeStatus: async (id, body) => ({ job: { ...job, id, status: body.status } }),
    setFavorite: async (id, body) => ({ id, favorite: body.favorite }),
    updateMetadata: async (id, body) => ({ job: { ...job, id, company: String(body.value) } }),
    saveJd: async (id, body) => ({
      job: { ...job, id },
      jd: {
        text: body.text,
        contentHash: 'h',
        revision: '2',
        syncedAt: '2026-11-10T12:00:00.000Z',
      },
      cacheSync: 'ok',
    }),
    ...overrides,
  };
}

function injectedIntake(overrides = {}) {
  return {
    check: async body => ({
      url: body.url,
      tracked: null,
      seen: null,
    }),
    companies: async ({ q }) => ({ companies: [q + ' Corp'] }),
    preview: async body => ({
      company: body.company,
      role: body.role,
      url: body.url,
      jdPath: 'data/jds/x/y.md',
    }),
    add: async body => ({
      id: '55',
      company: body.company,
      role: body.role,
      jdPath: 'data/jds/x/y.md',
    }),
    ...overrides,
  };
}

function scanReportFixture() {
  return {
    dryRun: true,
    generatedAt: '2026-11-10T12:00:00.000Z',
    summary: {
      structured: 2,
      richOnly: 0,
      unclassified: 0,
      ok: 2,
      empty: 0,
      error: 0,
      jobsFound: 9,
      newOffers: 1,
      missingFullJd: 1,
    },
    companies: [
      {
        company: 'Fixture Co',
        classification: 'structured',
        provider: 'ashby-api',
        status: 'ok',
        jobsFound: 9,
        reason: null,
      },
    ],
    missing: [{ company: 'Fixture Co', title: 'Engineer', url: 'https://example.invalid/jobs/1' }],
  };
}

function injectedProviders(overrides = {}) {
  const readiness = { state: 'unknown', checkedAt: null, message: null };
  const doc = (revision = 'legacy') => ({
    functions: Object.fromEntries(
      ['evaluation', 'companyResearch', 'cv', 'coverLetter'].map(name => [
        name,
        { provider: 'claude', model: 'sonnet', source: revision === 'legacy' ? 'legacy' : 'file' },
      ]),
    ),
    revision,
    readiness: { claude: readiness, codex: readiness },
    models: { claude: ['sonnet', 'opus', 'haiku'], codex: ['gpt-5.5'] },
  });
  return {
    get: async () => doc(),
    put: async (name, body) => {
      const next = doc('a'.repeat(64));
      next.functions[name] = { provider: body.provider, model: body.model, source: 'file' };
      return next;
    },
    checkReadiness: async () => ({
      readiness: {
        claude: { state: 'ready', checkedAt: '2026-11-10T12:00:00.000Z', message: null },
        codex: {
          state: 'notLoggedIn',
          checkedAt: '2026-11-10T12:00:00.000Z',
          message: 'ChatGPT login required. Run codex login; API billing is not used.',
        },
      },
    }),
    resolve: async () => ({}),
    ...overrides,
    __doc: doc,
  };
}

function assertNoSecrets(response, secret) {
  assert.equal(response.body.includes(secret), false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
}

test('public schema exports are standalone serializable schemas with the contract fields', () => {
  assert.deepEqual(Object.keys(publicSchemas), [
    'HealthResponse',
    'ReadyResponse',
    'SessionResponse',
    'JobsQuery',
    'JobsResponse',
    'OverviewResponse',
    'JobDetailResponse',
    'LivenessSummaryResponse',
    'JobMaterialParams',
    'JobStatusRequest',
    'JobMetadataRequest',
    'JobJdRequest',
    'JobWriteResponse',
    'JobFavoriteRequest',
    'JobFavoriteResponse',
    'JobJdWriteResponse',
    'ProvidersSettingsResponse',
    'ProvidersPutRequest',
    'ProvidersReadinessRequest',
    'ProvidersReadinessResponse',
    'IntakeCheckRequest',
    'IntakeCheckResponse',
    'IntakeCompaniesResponse',
    'IntakeSubmitRequest',
    'IntakeFetchRequest',
    'IntakeFetchResponse',
    'CostSummaryResponse',
    'CostCallsResponse',
    'IntakePreviewResponse',
    'IntakeAddResponse',
    'ScanReportResponse',
    'LetterPutRequest',
    'LetterResponse',
    'RunCreateRequest',
    'RunCreateResponse',
    'RunBatchRequest',
    'RunBatchResponse',
    'RunCancelQueuedRequest',
    'RunCancelQueuedResponse',
    'RunsResponse',
    'RunResponse',
    'RunLogResponse',
    'ErrorResponse',
  ]);
  for (const schema of Object.values(publicSchemas)) {
    assert.equal(typeof schema.$id, 'string');
    assert.doesNotThrow(() => JSON.stringify(schema));
  }
  assert.deepEqual(publicSchemas.SessionResponse.properties.data.properties.capabilities.required, [
    'jobReads',
    'jobDetail',
    'jobWrites',
    'intake',
    'providerSettings',
    'taskDispatch',
  ]);
});

test('health is live without touching readiness and has a no-store success envelope', async () => {
  let readinessCalls = 0;
  await withApp({ readiness: async () => readinessCalls++ }, async app => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, { status: 'ok' });
    assert.equal(response.json().meta.requestId.length > 0, true);
    assert.equal(Number.isNaN(Date.parse(response.json().meta.observedAt)), false);
    assert.equal(readinessCalls, 0);
    assert.equal(response.headers['cache-control'], 'no-store');
  });
});

test('ready reports truthful read-only capabilities from the injected readiness check', async () => {
  const cases = [
    [undefined, { ready: false, reason: 'notConfigured' }],
    [null, { ready: false, reason: 'notConfigured' }],
    [injectedRuns(), { ready: true, reason: null }],
    [injectedRuns({ ready: async () => false }), { ready: false, reason: 'notAvailable' }],
  ];
  for (const [runsService, taskDispatch] of cases) {
    await withApp({ readiness: async () => ({ ready: true }), runsService }, async app => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers: { host } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().data, {
        ready: true,
        database: 'ready',
        schema: 'ready',
        taskDispatch,
      });
      // The session reports the same truth.
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host },
      });
      assert.equal(session.json().data.capabilities.taskDispatch, taskDispatch.ready);
    });
  }
});

test('readiness uses only injected read transport and distinguishes schema from DB failure', async () => {
  let sqlSeen = '';
  const check = createReadinessCheck({
    query: async sql => {
      sqlSeen = sql;
      return [{ tables_ready: true, functions_ready: true, read_columns_ready: true }];
    },
  });
  await check();
  assert.match(sqlSeen, /pg_catalog/);
  assert.doesNotMatch(sqlSeen, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);

  const secret = 'private-db-password-sentinel';
  await assert.rejects(
    createReadinessCheck({
      query: async () => {
        throw new Error(secret);
      },
    })(),
    error => error.name === 'DatabaseUnavailableError' && !error.message.includes(secret),
  );
  for (const code of ['ECONNREFUSED', '57P01', '08006', '28P01', '57014', undefined])
    await assert.rejects(
      createReadinessCheck({
        query: async () => {
          throw Object.assign(new Error(secret), { code });
        },
      })(),
      { name: 'DatabaseUnavailableError' },
      String(code),
    );
  for (const code of ['42883', '42P01', '42804', '42703'])
    await assert.rejects(
      createReadinessCheck({
        query: async () => {
          throw Object.assign(new Error(secret), { code });
        },
      })(),
      error =>
        error.name === 'SchemaNotReadyError' &&
        !error.message.includes(secret) &&
        error.cause?.code === code,
      code,
    );
  await assert.rejects(
    createReadinessCheck({
      query: async () => [{ tables_ready: false, functions_ready: true, read_columns_ready: true }],
    })(),
    { name: 'SchemaNotReadyError' },
  );
});

test('database and schema errors are safe public envelopes', async () => {
  const secret = 'private-db-password-sentinel';
  await withApp(
    {
      readiness: createReadinessCheck({
        query: async () => {
          throw new Error(secret);
        },
      }),
    },
    async app => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers: { host } });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error.code, 'DATABASE_UNAVAILABLE');
      assertNoSecrets(response, secret);
    },
  );
  await withApp(
    {
      readiness: createReadinessCheck({
        query: async () => [{ tables_ready: false, functions_ready: true }],
      }),
    },
    async app => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers: { host } });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error.code, 'SCHEMA_NOT_READY');
      assertNoSecrets(response, secret);
    },
  );
});

test('session exposes a process nonce and only implemented capabilities', async () => {
  await withApp(
    {
      nonce: 'synthetic-session-nonce-value-000000000000',
      buildStamp: '2026-11-10T18:40:12.345Z',
      runsService: injectedRuns(),
    },
    async app => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().data, {
        apiVersion: '1',
        build: '2026-11-10T18:40:12.345Z',
        nonce: 'synthetic-session-nonce-value-000000000000',
        capabilities: {
          jobReads: true,
          jobDetail: true,
          jobWrites: true,
          intake: true,
          providerSettings: true,
          taskDispatch: true,
          cost: true,
        },
      });
    },
  );
  await withApp({ runsService: null }, async app => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(response.json().data.capabilities.taskDispatch, false);
  });
  await withApp({ runsService: injectedRuns({ ready: async () => false }) }, async app => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(response.json().data.capabilities.taskDispatch, false);
  });
});

test('jobs and overview routes wrap injected data and strictly validate URL query input', async () => {
  let seenQuery;
  let readerCalls = 0;
  await withApp(
    {
      jobsReader: injectedReader({
        list: async query => {
          readerCalls++;
          seenQuery = query;
          return injectedReader().list(query);
        },
      }),
    },
    async app => {
      const jobs = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs?filter=offer&limit=5',
        headers: { host },
      });
      assert.equal(jobs.statusCode, 200);
      assert.equal(jobs.json().data.query.filter, 'offer');
      assert.deepEqual({ ...seenQuery }, { filter: 'offer', limit: '5' });
      const overview = await app.inject({
        method: 'GET',
        url: '/api/v1/overview',
        headers: { host },
      });
      assert.equal(overview.statusCode, 200);
      assert.equal(overview.json().data.progress.funnel[0].percent, 100);
      for (const url of [
        '/api/v1/jobs?unexpected=1',
        '/api/v1/jobs?__proto__=x',
        '/api/v1/jobs?constructor=x',
        '/api/v1/jobs?toString=x',
        '/api/v1/jobs?filter=offer&filter=all',
        '/api/v1/jobs?limit=0',
        '/api/v1/overview?unexpected=1',
      ]) {
        const bad = await app.inject({ method: 'GET', url, headers: { host } });
        assert.equal(bad.statusCode, 400, url);
        assert.equal(bad.json().error.code, 'INVALID_REQUEST');
      }
      const deep = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs?filter=any&scoreMin=3.5&scoreMax=4&addedWeek=2026-W02',
        headers: { host },
      });
      assert.equal(deep.statusCode, 200);
      assert.deepEqual(
        { ...seenQuery },
        { filter: 'any', scoreMin: '3.5', scoreMax: '4', addedWeek: '2026-W02' },
      );
      for (const url of [
        '/api/v1/jobs?scoreMin=1&scoreMin=2',
        '/api/v1/jobs?addedWeek=2026-W02&addedWeek=2026-W03',
      ]) {
        const dup = await app.inject({ method: 'GET', url, headers: { host } });
        assert.equal(dup.statusCode, 400, url);
      }
      assert.equal(readerCalls, 2);
    },
  );
});

test('read route failures expose safe database/schema errors only', async () => {
  const privateSentinel = 'private-password-and-path-sentinel';
  for (const [error, code, status] of [
    [new DatabaseUnavailableError(privateSentinel), 'DATABASE_UNAVAILABLE', 503],
    [new SchemaNotReadyError(privateSentinel), 'SCHEMA_NOT_READY', 503],
  ]) {
    await withApp(
      {
        jobsReader: injectedReader({
          list: async () => {
            throw error;
          },
        }),
      },
      async app => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/jobs',
          headers: { host },
        });
        assert.equal(response.statusCode, status);
        assert.equal(response.json().error.code, code);
        assertNoSecrets(response, privateSentinel);
      },
    );
  }
});

test('default SQL reader ownership closes even with custom readiness; injected readers do not own the pool', async () => {
  let closed = 0;
  const app = createApp({
    host,
    origin,
    readiness: async () => ({ ready: true }),
    closeResources: async () => closed++,
  });
  await app.close();
  assert.equal(closed, 1);
  closed = 0;
  const injected = createApp({
    host,
    origin,
    readiness: async () => ({ ready: true }),
    jobsReader: injectedReader(),
    jobDetailReader: injectedDetail(),
    closeResources: async () => closed++,
  });
  await injected.close();
  assert.equal(closed, 0);
  const partial = createApp({
    host,
    origin,
    readiness: async () => ({ ready: true }),
    jobsReader: injectedReader(),
    closeResources: async () => closed++,
  });
  await partial.close();
  assert.equal(closed, 1, 'a default detail reader owns the pool');
});

test('localhost on the configured port is accepted for Host and Origin; the session origin stays 127.0.0.1', async () => {
  await withApp({}, async app => {
    for (const headers of [
      { host: 'localhost:4310' },
      { host: 'localhost:4310', origin: 'http://localhost:4310' },
      { host: 'localhost:4310', origin: 'http://127.0.0.1:4310' },
      { host, origin: 'http://localhost:4310' },
    ]) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers });
      assert.equal(response.statusCode, 200, JSON.stringify(headers));
    }
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/health',
      headers: { host: 'localhost:4310', origin: 'http://localhost:4310' },
    });
    assert.equal(preflight.statusCode, 403, 'preflight is still rejected');
  });
});

test('local request boundary rejects hostile Host, Origin, forwarding and fetch metadata', async () => {
  const hostileHeaders = [
    { host: 'localhost:4311' },
    { host: 'localhost.evil.test:4310' },
    { host: 'localhost' },
    { host: 'localhost:4310', origin: 'http://localhost:4311' },
    { host: 'localhost:4310', origin: 'http://localhost.evil.test:4310' },
    { host: 'localhost:4310', forwarded: 'host=evil.example' },
    { host: 'localhost:4310', 'x-forwarded-host': 'evil.example' },
    { host: 'localhost:4310', 'sec-fetch-site': 'cross-site' },
    { host, origin: 'http://evil.example' },
    { host, forwarded: 'host=evil.example' },
    { host, 'x-forwarded-host': 'evil.example' },
    { host, 'x-forwarded-for': '192.0.2.1' },
    { host, 'x-forwarded-port': '80' },
    { host, 'sec-fetch-site': 'cross-site' },
    { host, 'sec-fetch-site': 'same-site' },
  ];
  await withApp({}, async app => {
    for (const headers of hostileHeaders) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers });
      assert.equal(response.statusCode, 403, JSON.stringify(headers));
      assert.equal(response.json().error.code, 'LOCAL_REQUEST_REJECTED');
    }
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/health',
      headers: { host, origin, 'access-control-request-method': 'GET' },
    });
    assert.equal(preflight.statusCode, 403);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  });
});

test('development mode permits only the documented Vite origin', async () => {
  await withApp({ development: true }, async app => {
    const accepted = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { host, origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(accepted.statusCode, 200);
    const rejected = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { host, origin: 'http://localhost:5173' },
    });
    assert.equal(rejected.statusCode, 403);
  });
});

test('unknown query/body input, malformed JSON and oversized bodies fail safely', async () => {
  await withApp({}, async app => {
    const unknownQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/health?unexpected=1',
      headers: { host },
    });
    assert.equal(unknownQuery.statusCode, 400);
    assert.equal(unknownQuery.json().error.code, 'INVALID_REQUEST');
    const unknownBody = await app.inject({
      method: 'POST',
      url: '/api/v1/health',
      headers: { host, 'content-type': 'application/json' },
      payload: JSON.stringify({ unexpected: true }),
    });
    assert.equal(unknownBody.statusCode, 400);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/health',
      headers: { host, 'content-type': 'application/json' },
      payload: '{',
    });
    assert.equal(malformed.statusCode, 400);
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/health',
      headers: { host, 'content-type': 'application/json' },
      payload: 'x'.repeat(1024 * 1024 + 1),
    });
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.json().error.code, 'PAYLOAD_TOO_LARGE');
  });
});

test('static page and not-found paths ignore query strings while API routes still reject them', async () => {
  const staticHandler = (request, reply) =>
    reply.code(200).type('text/html; charset=utf-8').send('<!doctype html><title>page</title>');
  await withApp({ staticHandler, readiness: async () => {} }, async app => {
    for (const url of ['/?x=1', '/some/page?x=1', '/?q=&filter=all&sort=score&limit=50']) {
      const response = await app.inject({ method: 'GET', url, headers: { host } });
      assert.equal(response.statusCode, 200, url);
      assert.ok(response.body.includes('<title>page</title>'));
    }
    for (const url of ['/api/v1/overview?x=1', '/api/v1/health?x=1', '/api/v1/jobs?x=1']) {
      const response = await app.inject({ method: 'GET', url, headers: { host } });
      assert.equal(response.statusCode, 400, url);
      assert.equal(response.json().error.code, 'INVALID_REQUEST');
    }
  });
});

test('job detail and material routes validate params, wrap data and set safe headers', async () => {
  const reader = injectedDetail({
    detail: async id => {
      if (id === '404') throw publicFailure(404, 'NOT_FOUND');
      return detailFixture(id);
    },
  });
  await withApp(
    { readiness: async () => ({}), jobsReader: injectedReader(), jobDetailReader: reader },
    async app => {
      const ok = await app.inject({ method: 'GET', url: '/api/v1/jobs/7', headers: { host } });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.json().data.job.id, '7');
      assert.equal(ok.json().data.job.notes, 'note');
      assert.equal(ok.headers['cache-control'], 'no-store');
      assert.ok(ok.json().meta.requestId);
      const missing = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs/404',
        headers: { host },
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().error.code, 'NOT_FOUND');
      for (const url of ['/api/v1/jobs/7?x=1', '/api/v1/jobs/7/materials/cv?x=1']) {
        const response = await app.inject({ method: 'GET', url, headers: { host } });
        assert.equal(response.statusCode, 400, url);
        assert.equal(response.json().error.code, 'INVALID_REQUEST');
      }
      const body = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs/7',
        headers: { host, 'content-type': 'application/json' },
        payload: '{}',
      });
      assert.notEqual(body.statusCode, 200);
      const text = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs/7/materials/letter',
        headers: { host },
      });
      assert.equal(text.statusCode, 200);
      assert.equal(text.headers['content-type'], 'text/plain; charset=utf-8');
      assert.equal(text.headers['x-content-type-options'], 'nosniff');
      assert.equal(text.headers['cache-control'], 'no-store');
      assert.match(text.headers['content-security-policy'], /default-src 'none'/);
      assert.equal(text.body, '<b>hi</b>');
      const pdf = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs/7/materials/cv',
        headers: { host },
      });
      assert.equal(pdf.statusCode, 200);
      assert.equal(pdf.headers['content-type'], 'application/pdf');
      assert.equal(pdf.headers['content-disposition'], 'inline; filename="cv-a.pdf"');
      assert.equal(pdf.headers['x-content-type-options'], 'nosniff');
      assert.equal(pdf.headers['cache-control'], 'no-store');
      assert.equal(pdf.body, '%PDF');
    },
  );
});

test('reader validation errors reach the wire with their field names', async () => {
  const reader = injectedDetail({
    detail: async () => {
      throw publicFailure(400, 'INVALID_REQUEST', { id: 'Invalid value.' });
    },
    material: async () => {
      throw publicFailure(400, 'INVALID_REQUEST', { key: 'Invalid value.' });
    },
  });
  await withApp(
    { readiness: async () => ({}), jobsReader: injectedReader(), jobDetailReader: reader },
    async app => {
      const bad = await app.inject({ method: 'GET', url: '/api/v1/jobs/0', headers: { host } });
      assert.equal(bad.statusCode, 400);
      assert.deepEqual(Object.keys(bad.json().error.fields), ['id']);
      const key = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs/1/materials/resume',
        headers: { host },
      });
      assert.equal(key.statusCode, 400);
      assert.deepEqual(Object.keys(key.json().error.fields), ['key']);
    },
  );
});

test('detail database failures use the safe envelopes', async () => {
  const reader = injectedDetail({
    detail: async () => {
      throw new DatabaseUnavailableError();
    },
    material: async () => {
      throw new SchemaNotReadyError();
    },
  });
  await withApp(
    { readiness: async () => ({}), jobsReader: injectedReader(), jobDetailReader: reader },
    async app => {
      const db = await app.inject({ method: 'GET', url: '/api/v1/jobs/1', headers: { host } });
      assert.equal(db.statusCode, 503);
      assert.equal(db.json().error.code, 'DATABASE_UNAVAILABLE');
      const schema = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs/1/materials/cv',
        headers: { host },
      });
      assert.equal(schema.statusCode, 503);
      assert.equal(schema.json().error.code, 'SCHEMA_NOT_READY');
    },
  );
});

const NONCE = 'run-routes-nonce-value-0000000000000000000';
const postHeaders = { host, 'content-type': 'application/json', 'x-career-ops-session': NONCE };
const runBody = JSON.stringify({ action: 'evaluate', jobId: '12', requestKey: 'key-1' });

test('POST /runs goes through the write guard, validates the body and reports replays', async () => {
  await withApp({ nonce: NONCE, runsService: injectedRuns() }, async app => {
    const post = (headers, payload = runBody, url = '/api/v1/runs') =>
      app.inject({ method: 'POST', url, headers, payload });
    const created = await post(postHeaders);
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().data.runs[0].action, 'evaluate');
    assert.equal(created.json().data.replayed, false);
    assert.equal(created.headers['cache-control'], 'no-store');
    const replay = await post(
      postHeaders,
      JSON.stringify({ action: 'evaluate', jobId: '12', requestKey: 'replay' }),
    );
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.replayed, true);

    const { 'x-career-ops-session': _omit, ...noNonce } = postHeaders;
    for (const headers of [
      noNonce,
      { ...postHeaders, 'x-career-ops-session': 'wrong-nonce' },
      { ...postHeaders, 'content-type': 'text/plain' },
      { host, 'x-career-ops-session': NONCE },
    ]) {
      const response = await post(headers);
      assert.equal(response.statusCode, 403, JSON.stringify(headers));
      assert.equal(response.json().error.code, 'LOCAL_REQUEST_REJECTED');
    }
    for (const payload of [
      '{}',
      '{',
      JSON.stringify({ action: 'scan', jobId: '12', requestKey: 'k' }),
      JSON.stringify({ action: 'evaluate', jobId: '012', requestKey: 'k' }),
      JSON.stringify({ action: 'evaluate', jobId: '12', requestKey: 'bad key' }),
      JSON.stringify({ action: 'evaluate', jobId: '12', requestKey: 'k', script: 'x.mjs' }),
    ]) {
      const response = await post(postHeaders, payload);
      assert.equal(response.statusCode, 400, payload);
      assert.equal(response.json().error.code, 'INVALID_REQUEST');
    }
    const withQuery = await post(postHeaders, runBody, '/api/v1/runs?x=1');
    assert.equal(withQuery.statusCode, 400);
    const hostile = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { ...postHeaders, origin: 'http://evil.example' },
      payload: runBody,
    });
    assert.equal(hostile.statusCode, 403);
    const otherPost = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/1',
      headers: postHeaders,
      payload: runBody,
    });
    assert.notEqual(otherPost.statusCode, 201);
  });
});

test('run reads accept only their documented query parameters', async () => {
  const seen = [];
  const runs = injectedRuns({
    list: async query => {
      seen.push(['list', query]);
      return { runs: [runFixture()] };
    },
    log: async (id, options) => {
      seen.push(['log', options]);
      return { text: '', offset: 0, nextOffset: 0, size: 0, truncated: false };
    },
  });
  await withApp({ runsService: runs }, async app => {
    const get = url => app.inject({ method: 'GET', url, headers: { host } });
    assert.equal((await get('/api/v1/runs')).statusCode, 200);
    assert.equal((await get('/api/v1/runs?jobId=12')).statusCode, 200);
    assert.deepEqual(seen[1], ['list', { jobId: '12' }]);
    assert.equal((await get('/api/v1/runs?limit=5')).statusCode, 200);
    assert.deepEqual(seen.at(-1), ['list', { limit: '5' }]);
    assert.equal((await get('/api/v1/runs?other=1')).statusCode, 400);
    assert.equal((await get('/api/v1/runs?jobId=1&jobId=2')).statusCode, 400);
    const one = await get('/api/v1/runs/11111111-2222-4333-8444-555555555555');
    assert.equal(one.statusCode, 200);
    assert.equal(one.json().data.run.state, 'running');
    assert.equal(
      (await get('/api/v1/runs/11111111-2222-4333-8444-555555555555?x=1')).statusCode,
      400,
    );
    const id = '11111111-2222-4333-8444-555555555555';
    assert.equal((await get('/api/v1/runs/' + id + '/log')).statusCode, 200);
    const withOffset = await get('/api/v1/runs/' + id + '/log?offset=12');
    assert.equal(withOffset.statusCode, 200);
    assert.deepEqual(seen.at(-1), ['log', { offset: 12 }]);
    for (const bad of ['offset=abc', 'offset=-1', 'offset=1.5', 'offset=012', 'limit=5'])
      assert.equal((await get('/api/v1/runs/' + id + '/log?' + bad)).statusCode, 400, bad);
    const text = await get('/api/v1/runs/' + id + '/log');
    assert.equal(text.headers['content-type'].startsWith('application/json'), true);
  });
});

test('run routes use safe errors and report unavailability without a service', async () => {
  const failing = injectedRuns({
    dispatch: async () => {
      const error = new Error('That request key was used for another run.');
      error.statusCode = 409;
      error.publicCode = 'REQUEST_KEY_CONFLICT';
      throw error;
    },
    list: async () => {
      throw new DatabaseUnavailableError();
    },
    get: async () => {
      throw new SchemaNotReadyError();
    },
  });
  await withApp({ nonce: NONCE, runsService: failing }, async app => {
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: postHeaders,
      payload: runBody,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'REQUEST_KEY_CONFLICT');
    const db = await app.inject({ method: 'GET', url: '/api/v1/runs', headers: { host } });
    assert.equal(db.statusCode, 503);
    assert.equal(db.json().error.code, 'DATABASE_UNAVAILABLE');
    const schema = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/11111111-2222-4333-8444-555555555555',
      headers: { host },
    });
    assert.equal(schema.json().error.code, 'SCHEMA_NOT_READY');
  });
  await withApp({ nonce: NONCE, runsService: null }, async app => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: postHeaders,
      payload: runBody,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'TASKS_UNAVAILABLE');
    const read = await app.inject({ method: 'GET', url: '/api/v1/runs', headers: { host } });
    assert.equal(read.statusCode, 503);
  });
});

const WRITE_NONCE = 'job-write-nonce-value-0000000000000000000';
const writeHeaders = {
  host,
  'content-type': 'application/json',
  'x-career-ops-session': WRITE_NONCE,
};
const writeCases = [
  ['POST', '/api/v1/jobs/7/status', { expectedRevision: '4', status: 'Applied', reason: '' }],
  ['PATCH', '/api/v1/jobs/7/metadata', { field: 'company', expectedValue: 'A', value: 'B' }],
  ['PUT', '/api/v1/jobs/7/jd', { expectedRevision: '0', expectedHash: '', text: 'Role text' }],
];

test('job write routes go through the write guard and return the updated job', async () => {
  await withApp(
    { nonce: WRITE_NONCE, jobsWriter: injectedWriter(), runsService: null },
    async app => {
      for (const [method, url, body] of writeCases) {
        const send = (headers, payload = JSON.stringify(body), target = url) =>
          app.inject({ method, url: target, headers, payload });
        const ok = await send(writeHeaders);
        assert.equal(ok.statusCode, 200, url);
        assert.equal(ok.json().data.job.id, '7');
        assert.equal(ok.headers['cache-control'], 'no-store');
        const { 'x-career-ops-session': _omit, ...noNonce } = writeHeaders;
        for (const headers of [
          noNonce,
          { ...writeHeaders, 'x-career-ops-session': 'wrong-nonce' },
          { ...writeHeaders, 'content-type': 'text/plain' },
          { ...writeHeaders, origin: 'http://evil.example' },
        ]) {
          const rejected = await send(headers);
          assert.equal(rejected.statusCode, 403, url + JSON.stringify(headers));
          assert.equal(rejected.json().error.code, 'LOCAL_REQUEST_REJECTED');
        }
        assert.equal((await send(writeHeaders, '{', url)).statusCode, 400);
        assert.equal(
          (await send(writeHeaders, JSON.stringify(body), url + '?x=1')).statusCode,
          400,
        );
        const wrongMethod = await app.inject({
          method: 'DELETE',
          url,
          headers: writeHeaders,
          payload: JSON.stringify(body),
        });
        assert.ok([400, 403, 404, 405].includes(wrongMethod.statusCode));
        assert.notEqual(wrongMethod.statusCode, 200);
      }
      const jd = await app.inject({
        method: 'PUT',
        url: '/api/v1/jobs/7/jd',
        headers: writeHeaders,
        payload: JSON.stringify({
          expectedRevision: '0',
          expectedHash: '',
          text: 'x'.repeat(1024 * 1024 * 3),
        }),
      });
      assert.equal(jd.statusCode, 200, 'the JD route accepts bodies above the 1 MiB default');
      const tooLarge = await app.inject({
        method: 'PUT',
        url: '/api/v1/jobs/7/jd',
        headers: writeHeaders,
        payload: JSON.stringify({
          expectedRevision: '0',
          expectedHash: '',
          text: 'x'.repeat(5 * 1024 * 1024),
        }),
      });
      assert.equal(tooLarge.statusCode, 413);
      assert.equal(tooLarge.json().error.code, 'PAYLOAD_TOO_LARGE');
      const bigStatus = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs/7/status',
        headers: writeHeaders,
        payload: JSON.stringify({
          expectedRevision: '4',
          status: 'Applied',
          reason: 'x'.repeat(20000),
        }),
      });
      assert.equal(bigStatus.statusCode, 413, 'status and metadata bodies are capped at 16 KB');
    },
  );
});

test('job write conflicts carry the current state in error.current; unavailability is 503', async () => {
  const conflict = (publicCode, current) => async () => {
    const error = new Error('Conflict message.');
    error.statusCode = 409;
    error.publicCode = publicCode;
    error.current = current;
    throw error;
  };
  const writer = injectedWriter({
    changeStatus: conflict('REVISION_CONFLICT', { job: detailFixture().job }),
    updateMetadata: conflict('FIELD_CONFLICT', { job: detailFixture().job }),
    saveJd: conflict('JD_CONFLICT', { text: 'current', contentHash: 'h', revision: '3' }),
  });
  await withApp({ nonce: WRITE_NONCE, jobsWriter: writer, runsService: null }, async app => {
    const expected = ['REVISION_CONFLICT', 'FIELD_CONFLICT', 'JD_CONFLICT'];
    for (const [index, [method, url, body]] of writeCases.entries()) {
      const response = await app.inject({
        method,
        url,
        headers: writeHeaders,
        payload: JSON.stringify(body),
      });
      assert.equal(response.statusCode, 409, url);
      assert.equal(response.json().error.code, expected[index]);
      assert.ok(response.json().error.current, 'the current state is returned');
    }
    const jdConflict = await app.inject({
      method: 'PUT',
      url: '/api/v1/jobs/7/jd',
      headers: writeHeaders,
      payload: JSON.stringify(writeCases[2][2]),
    });
    assert.deepEqual(jdConflict.json().error.current, {
      text: 'current',
      contentHash: 'h',
      revision: '3',
    });
  });
  await withApp({ nonce: WRITE_NONCE, jobsWriter: null, runsService: null }, async app => {
    for (const [method, url, body] of writeCases) {
      const response = await app.inject({
        method,
        url,
        headers: writeHeaders,
        payload: JSON.stringify(body),
      });
      assert.equal(response.statusCode, 503, url);
      assert.equal(response.json().error.code, 'WRITES_UNAVAILABLE');
    }
    const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(session.json().data.capabilities.jobWrites, false);
  });
  await withApp(
    { nonce: WRITE_NONCE, jobsWriter: injectedWriter(), runsService: null },
    async app => {
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host },
      });
      assert.equal(session.json().data.capabilities.jobWrites, true);
    },
  );
});

test('materials accept an optional trailing filename that must match the resolved file', async () => {
  await withApp(
    {
      readiness: async () => ({}),
      jobsReader: injectedReader(),
      jobDetailReader: injectedDetail(),
    },
    async app => {
      const get = url => app.inject({ method: 'GET', url, headers: { host } });
      const plain = await get('/api/v1/jobs/7/materials/cv');
      assert.equal(plain.statusCode, 200);
      const named = await get('/api/v1/jobs/7/materials/cv/cv-a.pdf');
      assert.equal(named.statusCode, 200);
      assert.equal(named.headers['content-type'], 'application/pdf');
      assert.equal(named.body, '%PDF');
      const encoded = await get('/api/v1/jobs/7/materials/cv/cv-a%2Epdf');
      assert.equal(encoded.statusCode, 200);
      for (const wrong of ['other.pdf', 'CV-A.PDF', '..%2Fcv-a.pdf']) {
        const response = await get('/api/v1/jobs/7/materials/cv/' + wrong);
        assert.equal(response.statusCode, 404, wrong);
        assert.equal(response.json().error.code, 'NOT_FOUND');
      }
      const text = await get('/api/v1/jobs/7/materials/letter/x.md');
      assert.equal(text.statusCode, 200);
      assert.equal((await get('/api/v1/jobs/7/materials/cv/cv-a.pdf?x=1')).statusCode, 400);
      assert.equal((await get('/api/v1/jobs/7/materials/cv/a/b')).statusCode, 404);
    },
  );
});

const INTAKE_NONCE = 'intake-routes-nonce-value-000000000000000';
const intakeHeaders = {
  host,
  'content-type': 'application/json',
  'x-career-ops-session': INTAKE_NONCE,
};
const intakeBody = {
  url: 'https://example.invalid/job',
  company: 'Acme',
  role: 'Engineer',
  text: 'x'.repeat(120),
};

test('intake routes go through the write guard and return the service data', async () => {
  await withApp(
    { nonce: INTAKE_NONCE, intakeService: injectedIntake(), runsService: null },
    async app => {
      const post = (url, payload, headers = intakeHeaders) =>
        app.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) });
      const check = await post('/api/v1/intake/check', { url: 'https://example.invalid/job' });
      assert.equal(check.statusCode, 200);
      assert.deepEqual(check.json().data, {
        url: 'https://example.invalid/job',
        tracked: null,
        seen: null,
      });
      const preview = await post('/api/v1/intake/preview', intakeBody);
      assert.equal(preview.statusCode, 200);
      assert.equal(preview.json().data.jdPath, 'data/jds/x/y.md');
      const added = await post('/api/v1/intake', intakeBody);
      assert.equal(added.statusCode, 200);
      assert.equal(added.json().data.id, '55');
      for (const url of ['/api/v1/intake/check', '/api/v1/intake/preview', '/api/v1/intake']) {
        const { 'x-career-ops-session': _omit, ...noNonce } = intakeHeaders;
        for (const headers of [
          noNonce,
          { ...intakeHeaders, 'x-career-ops-session': 'wrong' },
          { ...intakeHeaders, 'content-type': 'text/plain' },
          { ...intakeHeaders, origin: 'http://evil.example' },
        ]) {
          const response = await post(url, intakeBody, headers);
          assert.equal(response.statusCode, 403, url);
        }
        assert.equal((await post(url + '?x=1', intakeBody)).statusCode, 400);
      }
      const huge = await post('/api/v1/intake/check', {
        url: 'https://x.example/' + 'a'.repeat(20000),
      });
      assert.equal(huge.statusCode, 413);
      const bigText = await post('/api/v1/intake', {
        ...intakeBody,
        text: 'x'.repeat(5 * 1024 * 1024),
      });
      assert.equal(bigText.statusCode, 413);
      const okText = await post('/api/v1/intake', {
        ...intakeBody,
        text: 'x'.repeat(3 * 1024 * 1024),
      });
      assert.equal(okText.statusCode, 200, 'the paste routes accept bodies above 1 MiB');
    },
  );
});

test('intake companies read validates its query and conflicts carry error.current', async () => {
  const seen = [];
  const failing = status => async () => {
    const error = new Error('Conflict message.');
    error.statusCode = 409;
    error.publicCode = status.code;
    error.current = status.current;
    throw error;
  };
  await withApp(
    {
      nonce: INTAKE_NONCE,
      runsService: null,
      intakeService: injectedIntake({
        companies: async query => (seen.push(query), { companies: ['Acme', 'Acme Two'] }),
        preview: failing({
          code: 'DUPLICATE_JOB',
          current: { tracked: { id: '5', company: 'A', role: 'R', status: 'Applied' } },
        }),
        add: failing({
          code: 'DISCOVERY_BUSY',
          current: { activeRunId: '11111111-2222-4333-8444-555555555555' },
        }),
        check: failing({
          code: 'SEEN_URL',
          current: { seen: { company: 'A', title: 'T', status: 'added', firstSeen: null } },
        }),
      }),
    },
    async app => {
      const get = url => app.inject({ method: 'GET', url, headers: { host } });
      const ok = await get('/api/v1/intake/companies?q=acm');
      assert.deepEqual(ok.json().data.companies, ['Acme', 'Acme Two']);
      assert.deepEqual(seen[0], { q: 'acm' });
      assert.equal((await get('/api/v1/intake/companies?q=a&x=1')).statusCode, 400);
      assert.equal((await get('/api/v1/intake/companies?q=a&q=b')).statusCode, 400);
      const post = (url, payload) =>
        app.inject({
          method: 'POST',
          url,
          headers: intakeHeaders,
          payload: JSON.stringify(payload),
        });
      const duplicate = await post('/api/v1/intake/preview', intakeBody);
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.json().error.code, 'DUPLICATE_JOB');
      assert.equal(duplicate.json().error.current.tracked.id, '5');
      const busy = await post('/api/v1/intake', intakeBody);
      assert.equal(busy.json().error.code, 'DISCOVERY_BUSY');
      assert.equal(busy.json().error.current.activeRunId, '11111111-2222-4333-8444-555555555555');
      const seenUrl = await post('/api/v1/intake/check', { url: 'https://example.invalid/job' });
      assert.equal(seenUrl.json().error.code, 'SEEN_URL');
    },
  );
  await withApp({ nonce: INTAKE_NONCE, runsService: null, intakeService: null }, async app => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/check',
      headers: intakeHeaders,
      payload: JSON.stringify({ url: 'https://example.invalid/job' }),
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'INTAKE_UNAVAILABLE');
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/intake/companies?q=a',
      headers: { host },
    });
    assert.equal(read.statusCode, 503);
    const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(session.json().data.capabilities.intake, false);
  });
  await withApp(
    { nonce: INTAKE_NONCE, runsService: null, intakeService: injectedIntake() },
    async app => {
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host },
      });
      assert.equal(session.json().data.capabilities.intake, true);
    },
  );
});

test('scan runs: POST accepts the scan variant, scan-report is served, DISCOVERY_BUSY carries the run id', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const dispatched = [];
  const runs = injectedRuns({
    dispatch: async input => {
      dispatched.push(input);
      if (input.requestKey === 'busy') {
        const error = new Error('A scan or pasted-JD intake is already running.');
        error.statusCode = 409;
        error.publicCode = 'DISCOVERY_BUSY';
        error.current = { activeRunId: id };
        throw error;
      }
      return { runs: [runFixture({ action: 'scan', jobId: null })], replayed: false };
    },
    scanReport: async runId => {
      if (runId !== id) {
        const error = new Error('Scan report is not available yet.');
        error.statusCode = 404;
        error.publicCode = 'NOT_FOUND';
        throw error;
      }
      return scanReportFixture();
    },
  });
  await withApp({ nonce: NONCE, runsService: runs }, async app => {
    const post = payload =>
      app.inject({
        method: 'POST',
        url: '/api/v1/runs',
        headers: postHeaders,
        payload: JSON.stringify(payload),
      });
    const scan = await post({
      action: 'scan',
      requestKey: 'scan-1',
      dryRun: true,
      company: 'Acme',
    });
    assert.equal(scan.statusCode, 201);
    assert.equal(scan.json().data.runs[0].action, 'scan');
    assert.equal(scan.json().data.runs[0].jobId, null);
    assert.deepEqual(dispatched[0], {
      action: 'scan',
      requestKey: 'scan-1',
      dryRun: true,
      company: 'Acme',
    });
    const noCompany = await post({ action: 'scan', requestKey: 'scan-2', dryRun: false });
    assert.equal(noCompany.statusCode, 201);
    for (const bad of [
      { action: 'scan', requestKey: 'k' },
      { action: 'scan', requestKey: 'k', dryRun: 'yes' },
      { action: 'scan', requestKey: 'k', dryRun: true, jobId: '5' },
      { action: 'scan', requestKey: 'bad key', dryRun: true },
      { action: 'scan', requestKey: 'k', dryRun: true, company: '' },
      { action: 'scan', requestKey: 'k', dryRun: true, company: 'x'.repeat(101) },
      { action: 'scan', requestKey: 'k', dryRun: true, extra: 1 },
    ]) {
      const response = await post(bad);
      assert.equal(response.statusCode, 400, JSON.stringify(bad));
    }
    const busy = await post({ action: 'scan', requestKey: 'busy', dryRun: false });
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.json().error.code, 'DISCOVERY_BUSY');
    assert.equal(busy.json().error.current.activeRunId, id);
    const report = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/' + id + '/scan-report',
      headers: { host },
    });
    assert.equal(report.statusCode, 200);
    assert.equal(report.json().data.summary.missingFullJd, 1);
    assert.equal(report.json().data.missing[0].url, 'https://example.invalid/jobs/1');
    const absent = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/00000000-0000-4000-8000-000000000000/scan-report',
      headers: { host },
    });
    assert.equal(absent.statusCode, 404);
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/runs/' + id + '/scan-report?x=1',
          headers: { host },
        })
      ).statusCode,
      400,
    );
  });
});

const PROVIDER_NONCE = 'provider-routes-nonce-value-00000000000000';
const providerHeaders = {
  host,
  'content-type': 'application/json',
  'x-career-ops-session': PROVIDER_NONCE,
};

test('provider settings routes: read, guarded writes, conflicts, readiness and unavailability', async () => {
  const providers = injectedProviders({
    put: async (name, body) => {
      if (body.expectedRevision === 'b'.repeat(64)) {
        const error = new Error('The provider settings changed since you loaded them.');
        error.statusCode = 409;
        error.publicCode = 'SETTINGS_CONFLICT';
        error.current = providers.__doc('c'.repeat(64));
        throw error;
      }
      if (body.model === 'bad') {
        const error = new Error('Request field is invalid.');
        error.statusCode = 400;
        error.publicCode = 'INVALID_REQUEST';
        error.fields = { model: 'Invalid value.' };
        throw error;
      }
      const next = providers.__doc('a'.repeat(64));
      next.functions[name] = { provider: body.provider, model: body.model, source: 'file' };
      return next;
    },
  });
  await withApp(
    { nonce: PROVIDER_NONCE, runsService: null, providersService: providers },
    async app => {
      const read = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/providers',
        headers: { host },
      });
      assert.equal(read.statusCode, 200);
      assert.equal(read.json().data.revision, 'legacy');
      assert.deepEqual(Object.keys(read.json().data.functions), [
        'evaluation',
        'companyResearch',
        'cv',
        'coverLetter',
      ]);
      assert.equal(read.headers['cache-control'], 'no-store');
      assert.equal(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/settings/providers?x=1',
            headers: { host },
          })
        ).statusCode,
        400,
      );
      const put = (headers, payload, url = '/api/v1/settings/providers/cv', method = 'PUT') =>
        app.inject({ method, url, headers, payload: JSON.stringify(payload) });
      const good = { expectedRevision: 'legacy', provider: 'codex', model: 'gpt-5.5' };
      const saved = await put(providerHeaders, good);
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.json().data.revision, 'a'.repeat(64));
      assert.equal(saved.json().data.functions.cv.provider, 'codex');
      const { 'x-career-ops-session': _omit, ...noNonce } = providerHeaders;
      for (const [headers, url, method, payload] of [
        [noNonce, '/api/v1/settings/providers/cv', 'PUT', good],
        [
          { ...providerHeaders, 'x-career-ops-session': 'wrong' },
          '/api/v1/settings/providers/cv',
          'PUT',
          good,
        ],
        [
          { ...providerHeaders, 'content-type': 'text/plain' },
          '/api/v1/settings/providers/cv',
          'PUT',
          good,
        ],
        [
          { ...providerHeaders, origin: 'http://evil.example' },
          '/api/v1/settings/providers/cv',
          'PUT',
          good,
        ],
        [noNonce, '/api/v1/settings/providers/readiness', 'POST', {}],
        [
          { ...providerHeaders, 'content-type': 'text/plain' },
          '/api/v1/settings/providers/readiness',
          'POST',
          {},
        ],
      ])
        assert.equal((await put(headers, payload, url, method)).statusCode, 403, method + url);
      assert.equal(
        (await put(providerHeaders, good, '/api/v1/settings/providers/cv?x=1')).statusCode,
        400,
      );
      const conflict = await put(providerHeaders, { ...good, expectedRevision: 'b'.repeat(64) });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, 'SETTINGS_CONFLICT');
      assert.equal(conflict.json().error.current.revision, 'c'.repeat(64));
      const bad = await put(providerHeaders, { ...good, model: 'bad' });
      assert.equal(bad.statusCode, 400);
      assert.deepEqual(Object.keys(bad.json().error.fields), ['model']);
      const big = await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/providers/cv',
        headers: providerHeaders,
        payload: JSON.stringify({ ...good, model: 'x'.repeat(6000) }),
      });
      assert.equal(big.statusCode, 413);
      const check = await put(providerHeaders, {}, '/api/v1/settings/providers/readiness', 'POST');
      assert.equal(check.statusCode, 200);
      assert.equal(check.json().data.readiness.claude.state, 'ready');
      assert.equal(check.json().data.readiness.codex.state, 'notLoggedIn');
      for (const payload of [{ x: 1 }, [], 'x']) {
        const response = await put(
          providerHeaders,
          payload,
          '/api/v1/settings/providers/readiness',
          'POST',
        );
        assert.equal(response.statusCode, 400, JSON.stringify(payload));
      }
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host },
      });
      assert.equal(session.json().data.capabilities.providerSettings, true);
    },
  );
  await withApp({ nonce: PROVIDER_NONCE, runsService: null, providersService: null }, async app => {
    assert.equal(
      (
        await app.inject({ method: 'GET', url: '/api/v1/settings/providers', headers: { host } })
      ).json().error.code,
      'SETTINGS_UNAVAILABLE',
    );
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/providers/cv',
      headers: providerHeaders,
      payload: JSON.stringify({ expectedRevision: 'legacy', provider: 'claude', model: 'sonnet' }),
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'SETTINGS_UNAVAILABLE');
    const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(session.json().data.capabilities.providerSettings, false);
  });
});

test('dispatch accepts an optional selection override and reports the 409 shapes', async () => {
  const seen = [];
  const id = '11111111-2222-4333-8444-555555555555';
  const actions = {
    evaluate: { enabled: false, reason: 'Only Pending or Evaluated jobs can be evaluated.' },
    cv: { enabled: true, reason: null },
    letter: { enabled: true, reason: null },
    both: { enabled: true, reason: null },
  };
  const runs = injectedRuns({
    dispatch: async input => {
      seen.push(input);
      if (input.requestKey === 'prereq') {
        const error = new Error('Only Pending or Evaluated jobs can be evaluated.');
        error.statusCode = 409;
        error.publicCode = 'PREREQUISITE_FAILED';
        error.current = { actions };
        throw error;
      }
      if (input.requestKey === 'active') {
        const error = new Error('A cv run is already active.');
        error.statusCode = 409;
        error.publicCode = 'RUN_ACTIVE';
        error.current = { activeRunId: id };
        throw error;
      }
      return {
        runs: [
          runFixture({
            action: input.action,
            selection: input.selection ?? {},
          }),
        ],
        replayed: false,
      };
    },
  });
  await withApp({ nonce: NONCE, runsService: runs }, async app => {
    const post = payload =>
      app.inject({
        method: 'POST',
        url: '/api/v1/runs',
        headers: postHeaders,
        payload: JSON.stringify(payload),
      });
    const selection = {
      evaluation: { provider: 'codex', model: 'gpt-5.5' },
      companyResearch: { provider: 'claude', model: 'haiku' },
    };
    const ok = await post({ action: 'evaluate', jobId: '12', requestKey: 'k-1', selection });
    assert.equal(ok.statusCode, 201);
    assert.deepEqual(seen[0].selection, selection);
    assert.deepEqual(
      ok.json().data.runs[0].selection,
      selection,
      'the merged selection is on the wire',
    );
    assert.equal((await post({ action: 'cv', jobId: '12', requestKey: 'k-2' })).statusCode, 201);
    for (const bad of [
      { evaluation: { provider: 'openai', model: 'x' } },
      { evaluation: { provider: 'claude', model: '' } },
      { evaluation: { provider: 'claude', model: 'x'.repeat(81) } },
      { evaluation: { provider: 'claude', model: 'x', extra: 1 } },
      { unknown: { provider: 'claude', model: 'x' } },
      'claude',
      [],
    ]) {
      const response = await post({
        action: 'evaluate',
        jobId: '12',
        requestKey: 'k-bad',
        selection: bad,
      });
      assert.equal(response.statusCode, 400, JSON.stringify(bad));
    }
    const prereq = await post({ action: 'evaluate', jobId: '12', requestKey: 'prereq' });
    assert.equal(prereq.statusCode, 409);
    assert.equal(prereq.json().error.code, 'PREREQUISITE_FAILED');
    assert.deepEqual(prereq.json().error.current.actions, actions);
    const active = await post({ action: 'cv', jobId: '12', requestKey: 'active' });
    assert.equal(active.statusCode, 409);
    assert.equal(active.json().error.code, 'RUN_ACTIVE');
    assert.deepEqual(active.json().error.current, { activeRunId: id });
  });
});

test('all responses carry restrictive security headers and errors stay generic', async () => {
  await withApp({}, async app => {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/not-here', headers: { host } });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'NOT_FOUND');
    assert.equal(missing.headers['cache-control'], 'no-store');
    assert.equal(missing.headers['x-frame-options'], 'DENY');
    assert.match(missing.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(missing.headers['access-control-allow-origin'], undefined);
  });
});

test('future write guard requires exact nonce and JSON content type', () => {
  const request = {
    headers: {
      'x-career-ops-session': 'expected',
      'content-type': 'application/json; charset=utf-8',
    },
  };
  assert.doesNotThrow(() => requireSessionNonce(request, 'expected'));
  assert.throws(() => requireSessionNonce(request, 'other'), {
    publicCode: 'LOCAL_REQUEST_REJECTED',
  });
  assert.throws(
    () =>
      requireSessionNonce(
        { headers: { 'x-career-ops-session': 'expected', 'content-type': 'text/plain' } },
        'expected',
      ),
    { publicCode: 'LOCAL_REQUEST_REJECTED' },
  );
});

test('default readiness closes the injected owned resource on app shutdown', async () => {
  let closed = 0;
  const app = createApp({ host, origin, closeResources: async () => closed++ });
  await app.close();
  assert.equal(closed, 1);
});

const HASH_A = 'a'.repeat(64);
function letterState(overrides = {}) {
  return {
    name: 'cover-letter.md',
    text: 'Dear team,\n',
    contentHash: HASH_A,
    pdf: null,
    editable: true,
    ...overrides,
  };
}

test('letter routes: GET is a plain read, PUT goes through the write guard and carries conflicts', async () => {
  const seen = [];
  const letterService = {
    read: async id => {
      if (id === '404') throw publicFailure(404, 'NOT_FOUND');
      return letterState();
    },
    save: async (id, body) => {
      seen.push([id, body]);
      if (body.text === 'conflict') {
        const error = publicFailure(409, 'LETTER_CONFLICT');
        error.current = { text: 'theirs', contentHash: 'b'.repeat(64) };
        throw error;
      }
      return letterState({ text: body.text });
    },
  };
  await withApp({ nonce: WRITE_NONCE, letterService, runsService: null }, async app => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/7/letter',
      headers: { host },
    });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().data.name, 'cover-letter.md');
    assert.equal(read.headers['cache-control'], 'no-store');
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/jobs/404/letter', headers: { host } }))
        .statusCode,
      404,
    );
    const body = { expectedHash: HASH_A, text: 'Hello\n' };
    const put = (headers, payload = JSON.stringify(body), url = '/api/v1/jobs/7/letter') =>
      app.inject({ method: 'PUT', url, headers, payload });
    const ok = await put(writeHeaders);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(seen.at(-1), ['7', body]);
    const { 'x-career-ops-session': _omit, ...noNonce } = writeHeaders;
    for (const headers of [
      noNonce,
      { ...writeHeaders, 'x-career-ops-session': 'wrong' },
      { ...writeHeaders, 'content-type': 'text/plain' },
    ])
      assert.equal((await put(headers)).statusCode, 403);
    for (const payload of [
      '{',
      JSON.stringify({ text: 'x' }),
      JSON.stringify({ expectedHash: 'short', text: 'x' }),
      JSON.stringify({ expectedHash: HASH_A, text: 5 }),
      JSON.stringify({ ...body, extra: 1 }),
    ])
      assert.equal((await put(writeHeaders, payload)).statusCode, 400, payload);
    assert.equal((await put(writeHeaders, undefined, '/api/v1/jobs/7/letter?x=1')).statusCode, 400);
    const conflict = await put(writeHeaders, JSON.stringify({ ...body, text: 'conflict' }));
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'LETTER_CONFLICT');
    assert.deepEqual(conflict.json().error.current, {
      text: 'theirs',
      contentHash: 'b'.repeat(64),
    });
    const big = await put(
      writeHeaders,
      JSON.stringify({ expectedHash: HASH_A, text: '\u0001'.repeat(256 * 1024) }),
    );
    assert.equal(big.statusCode, 200, 'a body of JSON-escaped control text is still accepted');
  });
  await withApp({ nonce: WRITE_NONCE, runsService: null, letterService: null }, async app => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/7/letter',
      headers: { host },
    });
    assert.equal(read.statusCode, 503);
    assert.equal(read.json().error.code, 'WRITES_UNAVAILABLE');
  });
});

test('POST /runs accepts the publish variant with an expected hash and nothing else', async () => {
  const seen = [];
  const runs = injectedRuns({
    dispatch: async input => {
      seen.push(input);
      return { runs: [runFixture({ action: 'publish', jobId: input.jobId })], replayed: false };
    },
  });
  await withApp({ nonce: WRITE_NONCE, runsService: runs }, async app => {
    const post = payload =>
      app.inject({
        method: 'POST',
        url: '/api/v1/runs',
        headers: writeHeaders,
        payload: JSON.stringify(payload),
      });
    const good = { action: 'publish', jobId: '12', requestKey: 'pub-1', expectedHash: HASH_A };
    const ok = await post(good);
    assert.equal(ok.statusCode, 201);
    assert.equal(ok.json().data.runs[0].action, 'publish');
    assert.deepEqual(seen, [good]);
    for (const bad of [
      { ...good, expectedHash: undefined },
      { ...good, expectedHash: 'xyz' },
      { ...good, selection: {} },
      { ...good, path: 'output/x/cover-letter.md' },
      { action: 'cv', jobId: '12', requestKey: 'pub-2', expectedHash: HASH_A },
    ])
      assert.equal((await post(bad)).statusCode, 400, JSON.stringify(bad));
  });
});

test('letter PDF route serves the published file inline with safe headers', async () => {
  const letterService = {
    pdf: async id => {
      if (id === '404') throw publicFailure(404, 'NOT_FOUND');
      return {
        name: 'cover-letter.pdf',
        size: 8,
        stream: () => Readable.from([Buffer.from('%PDF-1.4')]),
      };
    },
  };
  await withApp({ letterService, runsService: null }, async app => {
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/7/letter/pdf',
      headers: { host },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['content-type'], 'application/pdf');
    assert.equal(ok.headers['content-disposition'], 'inline; filename="cover-letter.pdf"');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.match(ok.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(ok.body, '%PDF-1.4');
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/404/letter/pdf',
      headers: { host },
    });
    assert.equal(missing.statusCode, 404);
  });
  await withApp({ letterService: null, runsService: null }, async app => {
    const off = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/7/letter/pdf',
      headers: { host },
    });
    assert.equal(off.statusCode, 503);
  });
});

test('the default run service needs a detail reader with actionsFor', () => {
  const { actionsFor: _omit, ...withoutActions } = injectedDetail();
  assert.throws(
    () =>
      createApp({
        host,
        origin,
        jobsReader: injectedReader(),
        jobDetailReader: withoutActions,
      }),
    /actionsFor/,
  );
  // Fixture servers that inject a run service or a readiness check are unaffected.
  assert.doesNotThrow(() =>
    createApp({
      host,
      origin,
      readiness: async () => ({ ready: true }),
      jobsReader: injectedReader(),
      jobDetailReader: withoutActions,
    }),
  );
});

test('cost routes validate queries strictly, stay read-only and report capability', async () => {
  const seen = [];
  const zero = {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0,
  };
  const costService = {
    summary: async input => {
      seen.push(['summary', input]);
      return {
        range: input.range,
        since: null,
        until: '2026-11-12T00:00:00.000Z',
        totals: zero,
        byModel: [],
        byFunction: [],
        byJob: [],
        byDay: [],
        prices: [],
        unpriced: [],
      };
    },
    calls: async input => {
      seen.push(['calls', input]);
      return { range: input.range, calls: [], total: 0 };
    },
  };
  await withApp({ costService }, async app => {
    const get = url => app.inject({ method: 'GET', url, headers: { host } });
    assert.equal((await get('/api/v1/cost/summary')).json().data.range, '30d');
    assert.equal((await get('/api/v1/cost/summary?range=all')).json().data.range, 'all');
    assert.deepEqual((await get('/api/v1/cost/calls?range=7d&jobId=5&limit=20')).json().data, {
      range: '7d',
      calls: [],
      total: 0,
    });
    assert.deepEqual(seen.at(-1), [
      'calls',
      { range: '7d', estimates: 'include', jobId: '5', limit: 20 },
    ]);
    await get('/api/v1/cost/summary?range=7d&estimates=exclude');
    assert.deepEqual(seen.at(-1), ['summary', { range: '7d', estimates: 'exclude' }]);
    for (const url of [
      '/api/v1/cost/summary?range=1d',
      '/api/v1/cost/summary?estimates=only',
      '/api/v1/cost/summary?estimates=include&estimates=exclude',
      '/api/v1/cost/calls?estimates=',
      '/api/v1/cost/summary?range=7d&range=30d',
      '/api/v1/cost/summary?jobId=1',
      '/api/v1/cost/summary?extra=1',
      '/api/v1/cost/calls?limit=501',
      '/api/v1/cost/calls?limit=0',
      '/api/v1/cost/calls?jobId=abc',
      '/api/v1/cost/calls?jobId=0',
    ]) {
      const response = await get(url);
      assert.equal(response.statusCode, 400, url);
      assert.equal(response.json().error.code, 'INVALID_REQUEST', url);
    }
    // No write path: POST without a route is not accepted and needs no nonce to be refused.
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/cost/summary',
      headers: { host, 'content-type': 'application/json' },
      payload: '{}',
    });
    assert.ok(post.statusCode >= 400);
    const session = await get('/api/v1/session');
    assert.equal(session.json().data.capabilities.cost, true);
  });
  await withApp({ costService: null }, async app => {
    for (const url of ['/api/v1/cost/summary', '/api/v1/cost/calls']) {
      const response = await app.inject({ method: 'GET', url, headers: { host } });
      assert.equal(response.statusCode, 503, url);
      assert.equal(response.json().error.code, 'COST_UNAVAILABLE');
    }
    const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(session.json().data.capabilities.cost, false);
  });
  await withApp(
    {
      costService: {
        summary: async () => {
          throw new DatabaseUnavailableError();
        },
        calls: async () => {
          throw new SchemaNotReadyError();
        },
      },
    },
    async app => {
      const summary = await app.inject({
        method: 'GET',
        url: '/api/v1/cost/summary',
        headers: { host },
      });
      assert.equal(summary.json().error.code, 'DATABASE_UNAVAILABLE');
      const calls = await app.inject({
        method: 'GET',
        url: '/api/v1/cost/calls',
        headers: { host },
      });
      assert.equal(calls.json().error.code, 'SCHEMA_NOT_READY');
    },
  );
});

test('batch evaluate and cancel-queued routes: nonce, body schema, status codes', async () => {
  const group = '11111111-2222-4333-8444-666666666666';
  const runs = injectedRuns({
    dispatchEvaluateBatch: async input => ({
      groupId: group,
      runs: [runFixture({ groupId: group })],
      skipped: input.jobIds?.includes('404') ? [{ jobId: '404', reason: 'Job not found.' }] : [],
      replayed: input.requestKey === 'replay',
    }),
    cancelQueued: async groupId => ({ groupId, cancelled: 2 }),
  });
  await withApp({ nonce: NONCE, runsService: runs }, async app => {
    const post = (url, headers, payload) => app.inject({ method: 'POST', url, headers, payload });
    const batch = '/api/v1/runs/evaluate-batch';
    const ok = await post(
      batch,
      postHeaders,
      JSON.stringify({ requestKey: 'k-b', jobIds: ['1', '404'] }),
    );
    assert.equal(ok.statusCode, 201);
    assert.equal(ok.json().data.runs.length, 1);
    assert.deepEqual(ok.json().data.skipped, [{ jobId: '404', reason: 'Job not found.' }]);
    const replay = await post(
      batch,
      postHeaders,
      JSON.stringify({ requestKey: 'replay', next: 2 }),
    );
    assert.equal(replay.statusCode, 200);
    const { 'x-career-ops-session': _omit, ...noNonce } = postHeaders;
    const bare = await post(batch, noNonce, JSON.stringify({ requestKey: 'k', next: 1 }));
    assert.equal(bare.statusCode, 403);
    for (const payload of [
      '{}',
      JSON.stringify({ requestKey: 'k', next: 1, jobIds: ['1'] }),
      JSON.stringify({ requestKey: 'k', jobIds: ['1', '1'] }),
      JSON.stringify({ requestKey: 'k', next: 101 }),
      JSON.stringify({ requestKey: 'k', next: 1, extra: 1 }),
    ])
      assert.equal((await post(batch, postHeaders, payload)).statusCode, 400, payload);

    const cancelUrl = `/api/v1/runs/groups/${group}/cancel-queued`;
    const cancel = await post(cancelUrl, postHeaders, '{}');
    assert.equal(cancel.statusCode, 200);
    assert.deepEqual(cancel.json().data, { groupId: group, cancelled: 2 });
    assert.equal((await post(cancelUrl, noNonce, '{}')).statusCode, 403);
  });
});

test('PUT favorite goes through the write guard, validates the body and returns { id, favorite }', async () => {
  await withApp(
    { nonce: WRITE_NONCE, jobsWriter: injectedWriter(), runsService: null },
    async app => {
      const url = '/api/v1/jobs/7/favorite';
      const send = (headers, payload, target = url) =>
        app.inject({ method: 'PUT', url: target, headers, payload });
      const ok = await send(writeHeaders, JSON.stringify({ favorite: true }));
      assert.equal(ok.statusCode, 200);
      assert.deepEqual(ok.json().data, { id: '7', favorite: true });
      const { 'x-career-ops-session': _omit, ...noNonce } = writeHeaders;
      assert.equal((await send(noNonce, JSON.stringify({ favorite: true }))).statusCode, 403);
      for (const payload of [
        '{}',
        '{',
        JSON.stringify({ favorite: 'yes' }),
        JSON.stringify({ favorite: true, x: 1 }),
      ])
        assert.equal((await send(writeHeaders, payload)).statusCode, 400, payload);
      const unavailable = await withApp(
        { nonce: WRITE_NONCE, jobsWriter: null, runsService: null },
        async bare => {
          const response = await bare.inject({
            method: 'PUT',
            url,
            headers: writeHeaders,
            payload: JSON.stringify({ favorite: true }),
          });
          assert.equal(response.statusCode, 503);
        },
      );
      assert.equal(unavailable, undefined);
    },
  );
});

test('the serialized list item and detail job on the wire contain the favorite flag', async () => {
  const { notes: _n, evaluationError: _e, ...item } = detailFixture().job;
  const reader = injectedReader({
    list: async query => ({
      ...(await injectedReader().list(query)),
      items: [{ ...item, favorite: true }],
      totalCount: 1,
    }),
  });
  const detail = injectedDetail({
    detail: async id => {
      const fixture = detailFixture(id);
      return { ...fixture, job: { ...fixture.job, favorite: true } };
    },
  });
  await withApp({ jobsReader: reader, jobDetailReader: detail, runsService: null }, async app => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/jobs', headers: { host } });
    assert.equal(list.statusCode, 200);
    const items = JSON.parse(list.body).data.items;
    assert.ok(items.length > 0);
    assert.ok(items.every(item => item.favorite === true));
    const one = await app.inject({ method: 'GET', url: '/api/v1/jobs/7', headers: { host } });
    assert.equal(one.statusCode, 200);
    assert.equal(JSON.parse(one.body).data.job.favorite, true);
  });
});

test('liveness: POST /runs accepts the liveness variant and GET /liveness/summary is served', async () => {
  const dispatched = [];
  const runs = injectedRuns({
    dispatch: async input => {
      dispatched.push(input);
      return {
        runs: [runFixture({ action: 'liveness', jobId: input.jobId ?? null })],
        replayed: false,
      };
    },
  });
  const summary = {
    running: false,
    lastFullCheck: {
      finishedAt: '2026-11-15T05:00:00.000Z',
      checked: 10,
      open: 6,
      closed: 3,
      probablyClosed: 1,
      unknown: 0,
      discarded: 2,
      flagged: 2,
      heldBack: 1,
    },
  };
  await withApp(
    { nonce: NONCE, runsService: runs, livenessService: { summary: async () => summary } },
    async app => {
      const post = payload =>
        app.inject({
          method: 'POST',
          url: '/api/v1/runs',
          headers: postHeaders,
          payload: JSON.stringify(payload),
        });
      assert.equal((await post({ action: 'liveness', requestKey: 'lv-1' })).statusCode, 201);
      assert.equal(
        (await post({ action: 'liveness', requestKey: 'lv-2', jobId: '7' })).statusCode,
        201,
      );
      assert.deepEqual(dispatched, [
        { action: 'liveness', requestKey: 'lv-1' },
        { action: 'liveness', requestKey: 'lv-2', jobId: '7' },
      ]);
      for (const bad of [
        { action: 'liveness' },
        { action: 'liveness', requestKey: 'k', jobId: '0' },
        { action: 'liveness', requestKey: 'k', dryRun: true },
      ])
        assert.equal((await post(bad)).statusCode, 400, JSON.stringify(bad));
      const read = await app.inject({
        method: 'GET',
        url: '/api/v1/liveness/summary',
        headers: { host },
      });
      assert.equal(read.statusCode, 200);
      assert.deepEqual(read.json().data, summary);
      const query = await app.inject({
        method: 'GET',
        url: '/api/v1/liveness/summary?x=1',
        headers: { host },
      });
      assert.equal(query.statusCode, 400);
    },
  );
  // Without a service the summary is empty, never an error.
  await withApp({ runsService: null }, async app => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/liveness/summary',
      headers: { host },
    });
    assert.deepEqual(read.json().data, { running: false, lastFullCheck: null });
  });
});

test('the daily posting check has one switch, on by the owner decision, guarding the only start call', async () => {
  const { LIVENESS_DAILY_ENABLED } = await import('./app.mjs');
  assert.equal(LIVENESS_DAILY_ENABLED, true);
  const source = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
  const starts = source.match(/livenessService\.start\(\)/g) ?? [];
  assert.equal(starts.length, 1);
  assert.match(source, /daily:\s*LIVENESS_DAILY_ENABLED\s*&&/);
  assert.match(
    source,
    /if \(LIVENESS_DAILY_ENABLED && livenessService[^)]*\)\s*livenessService\.start\(\)/,
  );
});

test('D125 the run request accepts locationConfirmed and the run item serializes detail', async () => {
  const seen = [];
  const runs = injectedRuns({
    dispatch: async input => {
      seen.push(input);
      return { runs: [runFixture({ requestKey: input.requestKey })], replayed: false };
    },
    get: async id => ({
      run: runFixture({
        id,
        state: 'failed',
        exitCode: 2,
        errorCode: 'LOCATION_REVIEW',
        detail: 'US only',
      }),
    }),
    list: async () => ({
      runs: [
        runFixture({
          state: 'failed',
          exitCode: 2,
          errorCode: 'LOCATION_REVIEW',
          detail: 'US only',
        }),
      ],
    }),
  });
  await withApp({ nonce: NONCE, runsService: runs }, async app => {
    const post = payload =>
      app.inject({ method: 'POST', url: '/api/v1/runs', headers: postHeaders, payload });
    const ok = await post(
      JSON.stringify({
        action: 'evaluate',
        jobId: '12',
        requestKey: 'lc-k',
        locationConfirmed: true,
      }),
    );
    assert.equal(ok.statusCode, 201);
    assert.equal(seen[0].locationConfirmed, true);
    for (const body of [
      { action: 'evaluate', jobId: '12', requestKey: 'k', locationConfirmed: 'yes' },
      { action: 'evaluate', jobId: '12', requestKey: 'k', locationConfirmed: true, extra: 1 },
    ])
      assert.equal((await post(JSON.stringify(body))).statusCode, 400);
    const one = await app.inject({
      method: 'GET',
      url: '/api/v1/runs/11111111-2222-4333-8444-555555555555',
      headers: { host },
    });
    assert.equal(JSON.parse(one.body).data.run.detail, 'US only');
    const list = await app.inject({ method: 'GET', url: '/api/v1/runs', headers: { host } });
    assert.equal(JSON.parse(list.body).data.runs[0].detail, 'US only');
    // The batch endpoint does not take it.
    const batch = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/evaluate-batch',
      headers: postHeaders,
      payload: JSON.stringify({ requestKey: 'b', next: 1, locationConfirmed: true }),
    });
    assert.equal(batch.statusCode, 400);
  });
});
