import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { close as closeDatabase } from '../lib/_database.mjs';
import { checkReadiness, DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { publicSchemas } from './schemas.mjs';
import { createJobsReader, normalizeJobsQuery } from './jobs-read.mjs';
import { createJobsDetail } from './jobs-detail.mjs';
import { createDiscoveryLock, createRunsService } from './runs.mjs';
import { createIntakeService } from './intake.mjs';
import { createIntakeFetchService } from './intake-fetch.mjs';
import { createProvidersService } from './providers.mjs';
import { createJobsWrite, MAX_JD_BYTES } from './jobs-write.mjs';
import { createGhosting } from './ghosting.mjs';
import { createCostService, normalizeCostQuery } from './cost.mjs';
import { createLetterService } from './letter.mjs';

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

// Explicit Host aliases for the one configured port: the loopback address the server listens on
// and the name "localhost" for bookmarks. Computed once; never derived from a request.
function allowedHosts({ host }) {
  const port = host.split(':').at(-1);
  return new Set([host, `localhost:${port}`]);
}

function allowedOrigins({ host, development }) {
  const origins = new Set([...allowedHosts({ host })].map(name => `http://${name}`));
  if (development) origins.add(DEVELOPMENT_ORIGIN);
  return origins;
}

function checkLocalRequest(request, { hosts, origins }) {
  if (
    !hosts.has(request.headers.host) ||
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

function sendError(
  reply,
  requestId,
  statusCode,
  code,
  message,
  retryable = false,
  fields,
  current,
) {
  const error = { code, message, requestId, retryable };
  if (fields) error.fields = fields;
  if (current !== undefined) error.current = current;
  return reply.code(statusCode).type('application/json').send({ error });
}

export function createApp({
  readiness = checkReadiness,
  host = DEFAULT_HOST,
  origin = DEFAULT_ORIGIN,
  development = false,
  nonce = randomBytes(32).toString('base64url'),
  buildStamp = 'dev',
  logger = false,
  staticHandler,
  closeResources = closeDatabase,
  jobsReader: injectedJobsReader,
  jobDetailReader: injectedDetailReader,
  runsService: injectedRunsService,
  jobsWriter: injectedWriter,
  ghosting: injectedGhosting,
  intakeService: injectedIntake,
  intakeFetchService: injectedIntakeFetch,
  providersService: injectedProviders,
  letterService: injectedLetter,
  costService: injectedCost,
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
  const jobDetailReader = injectedDetailReader || createJobsDetail();
  if (
    typeof jobDetailReader.detail !== 'function' ||
    typeof jobDetailReader.material !== 'function'
  )
    throw new TypeError('jobDetailReader must provide detail() and material().');
  // Run dispatch needs the real database: it is created by default only with the default
  // readiness check; tests and fixture servers inject a service or run without one.
  // Provider settings read and write private config files, so the default service exists only
  // with the default readiness check; fixture servers inject one or run without.
  const providersService =
    injectedProviders === undefined
      ? readiness === checkReadiness
        ? createProvidersService()
        : null
      : injectedProviders;
  // Letter editing and publication read and write files under output/, so the default service
  // exists only with the default readiness check; fixture servers inject one or run without.
  const letterService =
    injectedLetter === undefined
      ? readiness === checkReadiness
        ? createLetterService()
        : null
      : injectedLetter;
  // Cost reads the llm_calls table: the default service exists only with the default readiness
  // check; fixture servers inject one or run without.
  const costService =
    injectedCost === undefined
      ? readiness === checkReadiness
        ? createCostService()
        : null
      : injectedCost;
  const discoveryLock = createDiscoveryLock();
  // The default run service re-checks prerequisites and active runs through the detail reader; a
  // reader without actionsFor would silently skip those checks, so it is refused here.
  if (
    injectedRunsService === undefined &&
    readiness === checkReadiness &&
    typeof jobDetailReader.actionsFor !== 'function'
  )
    throw new TypeError('jobDetailReader must provide actionsFor() for run dispatch.');
  const runsService =
    injectedRunsService === undefined
      ? readiness === checkReadiness
        ? createRunsService({
            discoveryLock,
            letterService,
            resolveSelection: providersService ? action => providersService.resolve(action) : null,
            actionsFor: id => jobDetailReader.actionsFor(id),
          })
        : null
      : injectedRunsService;
  // Pasted intakes need the real database and the launcher; they share the discovery lock with
  // scan runs. Fixture servers inject a service or run without one.
  const intakeService =
    injectedIntake === undefined
      ? readiness === checkReadiness
        ? createIntakeService({
            discoveryLock,
            activeScanRunId: async () => (await runsService?.activeScan?.()) ?? null,
          })
        : null
      : injectedIntake;
  // URL intake fetch reaches the network; by default it exists only with the default intake
  // service, so fixture servers never make real requests.
  const intakeFetchService =
    injectedIntakeFetch === undefined
      ? injectedIntake === undefined && intakeService
        ? createIntakeFetchService()
        : null
      : injectedIntakeFetch;
  // Job writes and the hourly Ghosted rule use the real database: they exist by default only
  // with the default readiness check. Injected writers (fixture servers) are used as given; the
  // ghosting scheduler is never created when readiness or any reader is injected.
  const jobsWriter =
    injectedWriter === undefined
      ? readiness === checkReadiness
        ? createJobsWrite({ detailReader: jobDetailReader })
        : null
      : injectedWriter;
  const ghosting =
    injectedGhosting === undefined
      ? readiness === checkReadiness && !injectedJobsReader && !injectedDetailReader
        ? createGhosting()
        : null
      : injectedGhosting;
  // One truth for the session and /ready: a run service exists and its migration is applied.
  const taskDispatchStatus = async () => {
    if (!runsService) return { ready: false, reason: 'notConfigured' };
    const ready = await runsService.ready();
    return { ready, reason: ready ? null : 'notAvailable' };
  };
  const hosts = allowedHosts({ host });
  const origins = allowedOrigins({ host, development });
  origins.add(origin);

  app.addHook('onRequest', async (request, reply) => {
    decorateResponse(reply);
    request.requestId = randomUUID();
    try {
      checkLocalRequest(request, { hosts, origins });
    } catch (error) {
      return sendError(reply, request.requestId, error.statusCode, error.publicCode, error.message);
    }
    const requestPath = request.url.split('?', 1)[0];
    const isRunPost = request.method === 'POST' && requestPath === `${API_PREFIX}/runs`;
    if (
      isRunPost ||
      isJobWrite(request.method, requestPath) ||
      isIntakePost(request.method, requestPath) ||
      isProvidersWrite(request.method, requestPath)
    ) {
      try {
        requireSessionNonce(request, nonce);
      } catch (error) {
        return sendError(
          reply,
          request.requestId,
          error.statusCode,
          error.publicCode,
          error.message,
        );
      }
    }
  });
  app.addHook('onListen', async () => {
    if (runsService && injectedRunsService === undefined) runsService.start();
    if (ghosting && injectedGhosting === undefined) ghosting.start();
  });
  app.addHook('onClose', async () => {
    runsService?.stop?.();
    ghosting?.stop?.();
  });
  if (readiness === checkReadiness || !injectedJobsReader || !injectedDetailReader)
    app.addHook('onClose', async () => closeResources());

  app.addHook('preValidation', async request => {
    const path = request.url.split('?', 1)[0];
    if (path !== '/api' && !path.startsWith('/api/')) return;
    const get = request.method === 'GET';
    const queryAllowed =
      get &&
      (path === `${API_PREFIX}/jobs` ||
        path === `${API_PREFIX}/runs` ||
        path === `${API_PREFIX}/intake/companies` ||
        path === `${API_PREFIX}/settings/providers` ||
        path === `${API_PREFIX}/cost/summary` ||
        path === `${API_PREFIX}/cost/calls` ||
        /^\/api\/v1\/runs\/[^/]+\/log$/.test(path));
    const bodyAllowed =
      (request.method === 'POST' && path === `${API_PREFIX}/runs`) ||
      isJobWrite(request.method, path) ||
      isIntakePost(request.method, path) ||
      isProvidersWrite(request.method, path);
    if (
      (!queryAllowed && Object.keys(request.query || {}).length > 0) ||
      (!bodyAllowed && request.body !== undefined)
    )
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
    const allowed = new Set([
      'q',
      'filter',
      'sort',
      'direction',
      'grouped',
      'limit',
      'cursor',
      'scoreMin',
      'scoreMax',
      'addedWeek',
    ]);
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
        error.current,
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
    `${API_PREFIX}/jobs/:id`,
    { schema: { response: { 200: publicSchemas.JobDetailResponse } } },
    async request => ({
      data: await jobDetailReader.detail(request.params.id),
      meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
    }),
  );

  const sendMaterial = async (request, reply) => {
    const file = await jobDetailReader.material(request.params.id, request.params.key);
    // The optional trailing segment only names the tab; it must equal the resolved file name.
    if (request.params.filename !== undefined && request.params.filename !== file.name)
      throw apiError(404, 'NOT_FOUND', 'Job or material not found.');
    if (file.kind === 'pdf') {
      const safeName = file.name.replace(/[^A-Za-z0-9._ -]/g, '_');
      return reply
        .header('content-security-policy', "frame-ancestors 'none'; base-uri 'none'")
        .header('content-disposition', `inline; filename="${safeName}"`)
        .header('content-length', String(file.size))
        .type('application/pdf')
        .send(file.stream());
    }
    return reply.type('text/plain; charset=utf-8').send(file.text);
  };
  app.get(`${API_PREFIX}/jobs/:id/materials/:key`, sendMaterial);
  app.get(`${API_PREFIX}/jobs/:id/materials/:key/:filename`, sendMaterial);

  const writesUnavailable = () =>
    apiError(503, 'WRITES_UNAVAILABLE', 'Editing is not available in this server.');
  const writeRoute = (method, suffix, bodyLimit, operation, response) =>
    app.route({
      method,
      url: `${API_PREFIX}/jobs/:id/${suffix}`,
      bodyLimit,
      schema: { response: { 200: response } },
      handler: async request => {
        if (!jobsWriter) throw writesUnavailable();
        return {
          data: await jobsWriter[operation](request.params.id, request.body),
          meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
        };
      },
    });
  writeRoute('POST', 'status', 16 * 1024, 'changeStatus', publicSchemas.JobWriteResponse);
  writeRoute('PATCH', 'metadata', 16 * 1024, 'updateMetadata', publicSchemas.JobWriteResponse);
  writeRoute('PUT', 'jd', MAX_JD_BYTES * 2, 'saveJd', publicSchemas.JobJdWriteResponse);

  // Letter editing (STAGE3_LETTER_CONTRACT.md). Both routes exist only when a letter service does;
  // the PUT is a session-guarded write. 256 KB of text can reach 1.5 MB when JSON-escaped.
  app.get(
    `${API_PREFIX}/jobs/:id/letter`,
    { schema: { response: { 200: publicSchemas.LetterResponse } } },
    async request => {
      if (!letterService) throw writesUnavailable();
      return {
        data: await letterService.read(request.params.id),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );
  app.get(`${API_PREFIX}/jobs/:id/letter/pdf`, async (request, reply) => {
    if (!letterService) throw writesUnavailable();
    const file = await letterService.pdf(request.params.id);
    return reply
      .header('content-security-policy', "frame-ancestors 'none'; base-uri 'none'")
      .header('content-disposition', `inline; filename="${file.name}"`)
      .header('content-length', String(file.size))
      .type('application/pdf')
      .send(file.stream());
  });
  app.route({
    method: 'PUT',
    url: `${API_PREFIX}/jobs/:id/letter`,
    bodyLimit: 2 * 1024 * 1024,
    schema: {
      body: publicSchemas.LetterPutRequest,
      response: { 200: publicSchemas.LetterResponse },
    },
    handler: async request => {
      if (!letterService) throw writesUnavailable();
      return {
        data: await letterService.save(request.params.id, request.body),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  });

  const tasksUnavailable = () =>
    apiError(503, 'TASKS_UNAVAILABLE', 'Task dispatch is not available in this server.');
  const onlyQuery = (request, allowed) => {
    const keys = Object.keys(request.query || {});
    for (const key of keys)
      if (!allowed.includes(key) || typeof request.query[key] !== 'string') {
        const error = apiError(400, 'INVALID_REQUEST', 'Query parameter is invalid.');
        error.fields = { [key]: 'Invalid value.' };
        throw error;
      }
    return request.query || {};
  };

  app.post(
    `${API_PREFIX}/runs`,
    {
      schema: {
        body: publicSchemas.RunCreateRequest,
        response: { 200: publicSchemas.RunCreateResponse, 201: publicSchemas.RunCreateResponse },
      },
    },
    async (request, reply) => {
      if (!runsService) throw tasksUnavailable();
      const result = await runsService.dispatch(request.body);
      reply.code(result.replayed ? 200 : 201);
      return {
        data: result,
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/runs`,
    { schema: { response: { 200: publicSchemas.RunsResponse } } },
    async request => {
      if (!runsService) throw tasksUnavailable();
      const { jobId, limit } = onlyQuery(request, ['jobId', 'limit']);
      return {
        data: await runsService.list({
          ...(jobId === undefined ? {} : { jobId }),
          ...(limit === undefined ? {} : { limit }),
        }),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/runs/:id`,
    { schema: { response: { 200: publicSchemas.RunResponse } } },
    async request => {
      if (!runsService) throw tasksUnavailable();
      return {
        data: await runsService.get(request.params.id),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/runs/:id/scan-report`,
    { schema: { response: { 200: publicSchemas.ScanReportResponse } } },
    async request => {
      if (!runsService) throw tasksUnavailable();
      return {
        data: await runsService.scanReport(request.params.id),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  const settingsUnavailable = () =>
    apiError(503, 'SETTINGS_UNAVAILABLE', 'Provider settings are not available in this server.');
  app.get(
    `${API_PREFIX}/settings/providers`,
    { schema: { response: { 200: publicSchemas.ProvidersSettingsResponse } } },
    async request => {
      if (!providersService) throw settingsUnavailable();
      onlyQuery(request, []);
      return {
        data: await providersService.get(),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );
  app.route({
    method: 'PUT',
    url: `${API_PREFIX}/settings/providers/:function`,
    bodyLimit: 4 * 1024,
    schema: { response: { 200: publicSchemas.ProvidersSettingsResponse } },
    handler: async request => {
      if (!providersService) throw settingsUnavailable();
      return {
        data: await providersService.put(request.params.function, request.body),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  });
  app.route({
    method: 'POST',
    url: `${API_PREFIX}/settings/providers/readiness`,
    bodyLimit: 1024,
    schema: { response: { 200: publicSchemas.ProvidersReadinessResponse } },
    handler: async request => {
      if (!providersService) throw settingsUnavailable();
      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length > 0
      )
        throw apiError(400, 'INVALID_REQUEST', 'This request takes an empty JSON object.');
      return {
        data: await providersService.checkReadiness(),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  });

  const intakeUnavailable = () =>
    apiError(503, 'INTAKE_UNAVAILABLE', 'Pasted-JD intake is not available in this server.');
  const intakeRoute = (method, url, bodyLimit, operation, response) =>
    app.route({
      method,
      url: `${API_PREFIX}${url}`,
      bodyLimit,
      schema: { response: { 200: response } },
      handler: async request => {
        if (!intakeService) throw intakeUnavailable();
        return {
          data: await intakeService[operation](request.body),
          meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
        };
      },
    });
  intakeRoute('POST', '/intake/check', 8 * 1024, 'check', publicSchemas.IntakeCheckResponse);
  app.route({
    method: 'POST',
    url: `${API_PREFIX}/intake/fetch`,
    bodyLimit: 8 * 1024,
    schema: { response: { 200: publicSchemas.IntakeFetchResponse } },
    handler: async request => {
      if (!intakeFetchService) throw intakeUnavailable();
      return {
        data: await intakeFetchService.fetch(request.body),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  });
  intakeRoute(
    'POST',
    '/intake/preview',
    4 * 1024 * 1024,
    'preview',
    publicSchemas.IntakePreviewResponse,
  );
  intakeRoute('POST', '/intake', 4 * 1024 * 1024, 'add', publicSchemas.IntakeAddResponse);
  app.get(
    `${API_PREFIX}/intake/companies`,
    { schema: { response: { 200: publicSchemas.IntakeCompaniesResponse } } },
    async request => {
      if (!intakeService) throw intakeUnavailable();
      return {
        data: await intakeService.companies({ q: onlyQuery(request, ['q']).q }),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/runs/:id/log`,
    { schema: { response: { 200: publicSchemas.RunLogResponse } } },
    async request => {
      if (!runsService) throw tasksUnavailable();
      const { offset } = onlyQuery(request, ['offset']);
      if (offset !== undefined && !/^(0|[1-9][0-9]{0,14})$/.test(offset)) {
        const error = apiError(400, 'INVALID_REQUEST', 'Query parameter is invalid.');
        error.fields = { offset: 'Invalid value.' };
        throw error;
      }
      return {
        data: await runsService.log(request.params.id, {
          offset: offset === undefined ? undefined : Number(offset),
        }),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  const costUnavailable = () =>
    apiError(503, 'COST_UNAVAILABLE', 'Cost data is not available in this server.');
  app.get(
    `${API_PREFIX}/cost/summary`,
    { schema: { response: { 200: publicSchemas.CostSummaryResponse } } },
    async request => {
      if (!costService) throw costUnavailable();
      const allowed = ['range', 'estimates'];
      const query = normalizeCostQuery(onlyQuery(request, allowed), { allowed });
      return {
        data: await costService.summary(query),
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );
  app.get(
    `${API_PREFIX}/cost/calls`,
    { schema: { response: { 200: publicSchemas.CostCallsResponse } } },
    async request => {
      if (!costService) throw costUnavailable();
      const allowed = ['range', 'jobId', 'limit', 'estimates'];
      const query = normalizeCostQuery(onlyQuery(request, allowed), { allowed });
      return {
        data: await costService.calls(query),
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
          taskDispatch: await taskDispatchStatus(),
        },
        meta: { requestId: request.requestId, observedAt: new Date().toISOString() },
      };
    },
  );

  app.get(
    `${API_PREFIX}/session`,
    { schema: { response: { 200: publicSchemas.SessionResponse } } },
    async request => ({
      data: {
        apiVersion: '1',
        build: buildStamp,
        nonce,
        capabilities: {
          jobReads: true,
          jobDetail: true,
          jobWrites: Boolean(jobsWriter),
          intake: Boolean(intakeService),
          providerSettings: Boolean(providersService),
          cost: Boolean(costService),
          taskDispatch: (await taskDispatchStatus()).ready,
        },
      },
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

function isProvidersWrite(method, path) {
  return (
    (method === 'PUT' && /^\/api\/v1\/settings\/providers\/[^/]+$/.test(path)) ||
    (method === 'POST' && path === '/api/v1/settings/providers/readiness')
  );
}

function isIntakePost(method, path) {
  return (
    method === 'POST' &&
    [
      '/api/v1/intake',
      '/api/v1/intake/check',
      '/api/v1/intake/fetch',
      '/api/v1/intake/preview',
    ].includes(path)
  );
}

function isJobWrite(method, path) {
  return (
    (method === 'POST' && /^\/api\/v1\/jobs\/[^/]+\/status$/.test(path)) ||
    (method === 'PATCH' && /^\/api\/v1\/jobs\/[^/]+\/metadata$/.test(path)) ||
    (method === 'PUT' && /^\/api\/v1\/jobs\/[^/]+\/(?:jd|letter)$/.test(path))
  );
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
