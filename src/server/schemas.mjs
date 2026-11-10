const envelopeMeta = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'observedAt'],
  properties: {
    requestId: { type: 'string', minLength: 1 },
    observedAt: { type: 'string', format: 'date-time' },
  },
};

function successSchema(name, data) {
  return {
    $id: `https://career-ops.local/schemas/${name}`,
    title: name,
    type: 'object',
    additionalProperties: false,
    required: ['data', 'meta'],
    properties: { data, meta: envelopeMeta },
  };
}

const healthData = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { const: 'ok' } },
};

const readyData = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'database', 'schema', 'taskDispatch'],
  properties: {
    ready: { const: true },
    database: { const: 'ready' },
    schema: { const: 'ready' },
    taskDispatch: {
      type: 'object',
      additionalProperties: false,
      required: ['ready', 'reason'],
      properties: { ready: { const: false }, reason: { const: 'notImplemented' } },
    },
  },
};

const sessionData = {
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', 'nonce', 'capabilities'],
  properties: {
    apiVersion: { const: '1' },
    nonce: { type: 'string', minLength: 32, maxLength: 128 },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['jobReads', 'taskDispatch'],
      properties: { jobReads: { type: 'boolean' }, taskDispatch: { const: false } },
    },
  },
};

const statusEnum = [
  'Pending',
  'Evaluated',
  'Applied',
  'Interview',
  'Offer',
  'Rejected',
  'Discarded',
  'Ghosted',
];
const dateOrNull = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] };
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const jobItem = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'revision',
    'company',
    'role',
    'url',
    'status',
    'score',
    'addedDate',
    'statusDate',
    'discardReason',
    'salary',
    'compensation',
    'materials',
  ],
  properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]*$' },
    revision: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    company: { type: 'string' },
    role: { type: 'string' },
    url: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
    status: { type: 'string', enum: statusEnum },
    score: { anyOf: [{ type: 'number', minimum: 0, maximum: 5 }, { type: 'null' }] },
    addedDate: dateOrNull,
    statusDate: dateOrNull,
    discardReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    salary: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['min', 'max', 'source'],
          properties: {
            min: {
              anyOf: [
                { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' },
                { type: 'null' },
              ],
            },
            max: {
              anyOf: [
                { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' },
                { type: 'null' },
              ],
            },
            source: { const: 'manual' },
          },
        },
      ],
    },
    compensation: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'state'],
      properties: {
        text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        state: { type: 'string', enum: ['notEvaluated', 'manual', 'report', 'missing', 'invalid'] },
      },
    },
    materials: {
      type: 'object',
      additionalProperties: false,
      required: ['cv', 'letter'],
      properties: { cv: { type: 'boolean' }, letter: { type: 'boolean' } },
    },
  },
};

const jobsQuery = {
  $id: 'https://career-ops.local/schemas/JobsQuery',
  title: 'JobsQuery',
  type: 'object',
  additionalProperties: false,
  required: ['q', 'filter', 'sort', 'direction', 'grouped', 'limit'],
  properties: {
    q: { type: 'string', maxLength: 200 },
    filter: {
      type: 'string',
      enum: [
        'all',
        'pending',
        'evaluated',
        'applied',
        'interview',
        'ghosted',
        'top',
        'rejected',
        'discarded',
        'offer',
      ],
    },
    sort: { type: 'string', enum: ['score', 'statusDate', 'addedDate', 'company'] },
    direction: { type: 'string', enum: ['asc', 'desc'] },
    grouped: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
};

const jobsData = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'totalCount', 'nextCursor', 'previousCursor', 'query'],
  properties: {
    items: { type: 'array', maxItems: 200, items: jobItem },
    totalCount: { type: 'integer', minimum: 0 },
    nextCursor: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    previousCursor: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    query: jobsQuery,
  },
};

const statusCounts = {
  type: 'object',
  additionalProperties: false,
  required: ['Evaluated', 'Applied', 'Interview', 'Offer', 'Rejected', 'Discarded', 'Ghosted'],
  properties: Object.fromEntries(
    ['Evaluated', 'Applied', 'Interview', 'Offer', 'Rejected', 'Discarded', 'Ghosted'].map(
      status => [status, { type: 'integer', minimum: 0 }],
    ),
  ),
};

const labeledCount = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'count'],
  properties: { label: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
};

const overviewData = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'metrics', 'progress'],
  properties: {
    label: { const: 'inferredFromCurrentState' },
    metrics: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'actionable', 'byStatus', 'avgScore', 'topScore'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        actionable: { type: 'integer', minimum: 0 },
        byStatus: statusCounts,
        avgScore: { anyOf: [{ type: 'number', minimum: 0, maximum: 5 }, { type: 'null' }] },
        topScore: { anyOf: [{ type: 'number', minimum: 0, maximum: 5 }, { type: 'null' }] },
      },
    },
    progress: {
      type: 'object',
      additionalProperties: false,
      required: [
        'funnel',
        'responseRate',
        'interviewRate',
        'offerRate',
        'scoreBuckets',
        'weeklyActivity',
      ],
      properties: {
        funnel: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'count', 'percent'],
            properties: {
              label: {
                type: 'string',
                enum: ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer'],
              },
              count: { type: 'integer', minimum: 0 },
              percent: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
        },
        responseRate: { type: 'number', minimum: 0, maximum: 100 },
        interviewRate: { type: 'number', minimum: 0, maximum: 100 },
        offerRate: { type: 'number', minimum: 0, maximum: 100 },
        scoreBuckets: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: {
            ...labeledCount,
            properties: {
              label: {
                type: 'string',
                enum: ['4.5-5.0', '4.0-4.4', '3.5-3.9', '3.0-3.4', '  <3.0'],
              },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
        weeklyActivity: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['week', 'count'],
            properties: {
              week: { type: 'string', pattern: '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$' },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
};

const errorData = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'requestId', 'retryable'],
      properties: {
        code: { type: 'string', minLength: 1 },
        message: { type: 'string', minLength: 1 },
        requestId: { type: 'string', minLength: 1 },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
        current: {},
        retryable: { type: 'boolean' },
      },
    },
  },
};

export const publicSchemas = Object.freeze({
  HealthResponse: successSchema('HealthResponse', healthData),
  ReadyResponse: successSchema('ReadyResponse', readyData),
  SessionResponse: successSchema('SessionResponse', sessionData),
  JobsQuery: jobsQuery,
  JobsResponse: successSchema('JobsResponse', jobsData),
  OverviewResponse: successSchema('OverviewResponse', overviewData),
  ErrorResponse: {
    $id: 'https://career-ops.local/schemas/ErrorResponse',
    title: 'ErrorResponse',
    ...errorData,
  },
});
