import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { close as closeDatabase } from '../lib/_database.mjs';
import { checkReadiness, DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { publicSchemas } from './schemas.mjs';
import { createJobsReader, normalizeJobsQuery } from './jobs-read.mjs';

const DEFAULT_HOST = '127.0.0.1:4310';
const DEFAULT_ORIGIN = 'http://127.0.0.1:4310';
const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:5173';
const API_PREFIX = '/api/v1';
const BODY_LIMIT = 1024 * 1024;

function apiError(statusCode, code, message, retryable = false) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = code;
  error.retryable = retryable;
  return error;
}

function allowedOrigins({ host, development }) {
  const origins = new Set([`http://${host}`]);
  if (development) origins.add(DEVELOPMENT_ORIGIN);
  return origins;
}

function checkLocalRequest(request, { host, origins }) {
  if (
    request.headers.host !== host ||
    request.headers.forwarded !== undefined ||
    Object.keys(request.headers).some(name => name.startsWith('x-forwarded-'))
  ) {
    throw apiError(
      403,
      'LOCAL_REQUEST_REJECTED',
      'Request is not from the configured local origin.',
    );
  }

  const origin = request.headers.origin;
  if (origin !== undefined && !origins.has(origin)) {
    throw apiError(
      403,
      'LOCAL_REQUEST_REJECTED',
      'Request is not from the configured local origin.',
    );
  }

  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw apiError(403, 'LOCAL_REQUEST_REJECTED', 'Cross-site requests are not accepted.');
  }

  if (request.method === 'OPTIONS') {
    throw apiError(403, 'LOCAL_REQUEST_REJECTED', 'Cross-origin preflight is not accepted.');
  }
}

function decorateResponse(reply) {
  reply.header('cache-control', 'no-store');
  reply.header('pragma', 'no-cache');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'no-referrer');
  reply.header(
    'content-security-policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  reply.header('cross-origin-resource-policy', 'same-origin');
}

function sendError(reply, requestId, statusCode, code, message, retryable = false, fields) {
  const error = { code, message, requestId, retryable };
  if (fields) error.fields = fields;
  return reply.code(statusCode).type('application/json').send({ error });
}

export function createApp({
  readiness = checkReadiness,
  host = DEFAULT_HOST,
  origin = DEFAULT_ORIGIN,
  development = false,
  nonce = randomBytes(32).toString('base64url'),
  logger = false,
  staticHandler,
  closeResources = closeDatabase,
  jobsReader: injectedJobsReader,
} = {}) {
  const parsedOrigin = new URL(origin);
  const port = Number(host.split(':').at(-1));
  if (
    !/^127\.0\.0\.1:\d{1,5}$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    parsedOrigin.protocol !== 'http:' ||
    parsedOrigin.host !== host ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new TypeError(
      'Server host and origin must use the configured IPv4 loopback address and port.',
    );
  }
  const app = Fastify({
    logger,
    bodyLimit: BODY_LIMIT,
    trustProxy: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
        allErrors: true,
      },
    },
  });
  const jobsReader = injectedJobsReader || createJobsReader();
  if (typeof jobsReader.list !== 'function' || typeof jobsReader.overview !== 'function')
    throw new TypeError('jobsReader must provide list() and overview().');
  const origins = allowedOrigins({ host, development });
  origins.add(origin);

  app.addHook('onRequest', async (request, reply) => {
    decorateResponse(reply);
    request.requestId = randomUUID();
    try {
      checkLocalRequest(request, { host, origins });
    } catch (error) {
      return sendError(reply, request.requestId, error.statusCode, error.publicCode, error.message);
    }
  });
  if (readiness === checkReadiness || !injectedJobsReader)
    app.addHook('onClose', async () => closeResources());

  app.addHook('preValidation', async request => {
    const jobsList =
      request.method === 'GET' && request.url.split('?', 1)[0] === `${API_PREFIX}/jobs`;
    if ((!jobsList && Object.keys(request.query || {}).length > 0) || request.body !== undefined)
      throw apiError(
        400,
        'INVALID_REQUEST',
        'This endpoint does not accept query parameters or a request body.',
      );
  });

  app.addHook('preHandler', async request => {
    if (request.method !== 'GET' || request.url.split('?', 1)[0] !== `${API_PREFIX}/jobs`) return;
    const params = new URL(request.raw.url, 'http://127.0.0.1').searchParams;
    const raw = Object.create(null);
    const allowed = new Set(['q', 'filter', 'sort', 'direction', 'grouped', 'limit', 'cursor']);
    for (const [key, value] of params) {
      if (!allowed.has(key)) throw apiError(400, 'INVALID_REQUEST', 'Query parameter is invalid.');
      if (Object.hasOwn(raw, key))
        throw apiError(400, 'INVALID_REQUEST', 'Query parameter is invalid.');
      raw[key] = value;
    }
    request.jobsQuery = raw;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DatabaseUnavailableError)
      return sendError(
        reply,
        request.requestId,
        503,
        'DATABASE_UNAVAILABLE',
        'Database is unavailable.',
        true,
      );
    if (error instanceof SchemaNotReadyError)
      return sendError(
        reply,
        request.requestId,
        503,
        'SCHEMA_NOT_READY',
        'Required database schema is not ready.',
      );
    if (error.publicCode)
      return sendError(
        reply,
        request.requestId,
        error.statusCode || 400,
        error.publicCode,
        error.message,
        error.retryable,
        error.fields,
      );
    if (error.statusCode === 413)
      return sendError(
        reply,
        request.requestId,
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body exceeds the allowed size.',
      );
    if (error.statusCode === 400)
      return sendError(
        reply,
        request.requestId,
        400,
        'INVALID_REQUEST',
        'Request body is malformed or invalid.',
      );
    if (error.statusCode === 415)
      return sendError(
        reply,
        request.requestId,
        400,
        'INVALID_REQUEST',
        'Request content type is not supported.',
      );
    request.log.error({ requestId: request.requestId }, 'Unhandled server error');
    return sendError(
      reply,
      request.requestId,
      500,
      'INTERNAL_ERROR',
      'The request could not be completed.',
    );
  });

  app.get(
    `${API_PREFIX}/health`,
    { schema: { response: { 200: publicSchemas.HealthResponse } } },
    async request => ({
      data: { status: 'ok' },
      meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
    }),
  );

  app.get(
    `${API_PREFIX}/jobs`,
    { schema: { response: { 200: publicSchemas.JobsResponse } } },
    async request => {
      normalizeJobsQuery(request.jobsQuery || {});
      return {
        data: await jobsReader.list(request.jobsQuery || {}),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/overview`,
    { schema: { response: { 200: publicSchemas.OverviewResponse } } },
    async request => ({
      data: await jobsReader.overview(),
      meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
    }),
  );

  app.get(
    `${API_PREFIX}/ready`,
    { schema: { response: { 200: publicSchemas.ReadyResponse } } },
    async request => {
      await readiness();
      return {
        data: {
          ready: true,
          database: 'ready',
          schema: 'ready',
          taskDispatch: { ready: false, reason: 'notImplemented' },
        },
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/session`,
    { schema: { response: { 200: publicSchemas.SessionResponse } } },
    async request => ({
      data: { apiVersion: '1', nonce, capabilities: { jobReads: true, taskDispatch: false } },
      meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
    }),
  );

  app.setNotFoundHandler((request, reply) => {
    if (staticHandler && !request.url.startsWith('/api')) return staticHandler(request, reply);
    return sendError(
      reply,
      request.requestId || randomUUID(),
      404,
      'NOT_FOUND',
      'Route not found.',
    );
  });

  return app;
}

export function requireSessionNonce(request, expectedNonce) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    request.headers['x-career-ops-session'] !== expectedNonce ||
    contentType !== 'application/json'
  )
    throw apiError(
      403,
      'LOCAL_REQUEST_REJECTED',
      'A valid local session header and JSON content type are required.',
    );
}
