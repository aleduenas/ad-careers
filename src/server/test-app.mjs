import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, requireSessionNonce } from './app.mjs';
import { createReadinessCheck } from './readiness.mjs';
import { publicSchemas } from './schemas.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

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
    'ErrorResponse',
  ]);
  for (const schema of Object.values(publicSchemas)) {
    assert.equal(typeof schema.$id, 'string');
    assert.doesNotThrow(() => JSON.stringify(schema));
  }
  assert.deepEqual(publicSchemas.SessionResponse.properties.data.properties.capabilities.required, [
    'jobReads',
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
  await withApp({ readiness: async () => ({ ready: true }) }, async app => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers: { host } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, {
      ready: true,
      database: 'ready',
      schema: 'ready',
      taskDispatch: { ready: false, reason: 'notImplemented' },
    });
  });
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
  await withApp({ nonce: 'synthetic-session-nonce-value-000000000000' }, async app => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { host } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, {
      apiVersion: '1',
      nonce: 'synthetic-session-nonce-value-000000000000',
      capabilities: { jobReads: true, taskDispatch: false },
    });
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
      assert.equal(readerCalls, 1);
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
    closeResources: async () => closed++,
  });
  await injected.close();
  assert.equal(closed, 0);
});

test('local request boundary rejects hostile Host, Origin, forwarding and fetch metadata', async () => {
  const hostileHeaders = [
    { host: 'localhost:4310' },
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
