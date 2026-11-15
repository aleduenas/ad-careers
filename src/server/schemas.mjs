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
      properties: {
        ready: { type: 'boolean' },
        reason: {
          anyOf: [{ type: 'string', enum: ['notConfigured', 'notAvailable'] }, { type: 'null' }],
        },
      },
    },
  },
};

const sessionData = {
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', 'build', 'nonce', 'capabilities'],
  properties: {
    apiVersion: { const: '1' },
    // F16: build stamp of the running server (mtime of web/dist/index.html or 'dev'); the page
    // compares it with its own and asks for a restart when they differ.
    build: { type: 'string', minLength: 1, maxLength: 64 },
    nonce: { type: 'string', minLength: 32, maxLength: 128 },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: [
        'jobReads',
        'jobDetail',
        'jobWrites',
        'intake',
        'providerSettings',
        'taskDispatch',
      ],
      properties: {
        jobReads: { type: 'boolean' },
        jobDetail: { type: 'boolean' },
        jobWrites: { type: 'boolean' },
        intake: { type: 'boolean' },
        providerSettings: { type: 'boolean' },
        taskDispatch: { type: 'boolean' },
        // D084: optional so a server without the cost service (fixtures) may omit it.
        cost: { type: 'boolean' },
      },
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

// Latest posting check (D117), null when the job was never checked.
const postingStates = ['open', 'closed', 'probably_closed', 'unknown'];
const postingActions = ['none', 'flagged', 'discarded', 'held_back'];
const postingItem = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'action', 'checkedAt'],
      properties: {
        state: { type: 'string', enum: postingStates },
        action: { type: 'string', enum: postingActions },
        checkedAt: { type: 'string', format: 'date-time' },
      },
    },
  ],
};
const postingDetail = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'action', 'checkedAt', 'method', 'detail'],
      properties: {
        state: { type: 'string', enum: postingStates },
        action: { type: 'string', enum: postingActions },
        checkedAt: { type: 'string', format: 'date-time' },
        method: { type: 'string' },
        detail: { type: 'string' },
      },
    },
  ],
};

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
    'favorite',
    'yoeMin',
    'yoeConfidence',
    'posting',
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
    favorite: { type: 'boolean' },
    // D116/D117. Always present; null means no estimate / no check.
    yoeMin: { anyOf: [{ type: 'integer', minimum: 0, maximum: 40 }, { type: 'null' }] },
    yoeConfidence: {
      anyOf: [{ type: 'string', enum: ['high', 'medium', 'low', 'inferred'] }, { type: 'null' }],
    },
    posting: postingItem,
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
        'any',
      ],
    },
    sort: {
      type: 'string',
      enum: ['score', 'statusDate', 'addedDate', 'company', 'favorite', 'yoe'],
    },
    direction: { type: 'string', enum: ['asc', 'desc'] },
    grouped: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    // D061 deep-link filters (optional, echoed back only when set). A score bound applies only
    // to rows with a score above 0: scoreMin is inclusive, scoreMax exclusive. addedWeek is the
    // ISO week key the overview uses for weeklyActivity.
    scoreMin: { type: 'number', minimum: 0, maximum: 5 },
    scoreMax: { type: 'number', minimum: 0, maximum: 5 },
    addedWeek: { type: 'string', pattern: '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$' },
    // Echoed only when the favorites-only flag is set.
    favorite: { const: true },
    // D116 / D117 filters, echoed only when set.
    yoeMax: { type: 'integer', minimum: 0, maximum: 40 },
    yoeUnknown: { const: 'exclude' },
    posting: { type: 'string', enum: ['expired', 'applied-closed'] },
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

const idString = { type: 'string', pattern: '^[1-9][0-9]*$' };
const dateTime = { type: 'string', format: 'date-time' };
const dateTimeOrNull = { anyOf: [dateTime, { type: 'null' }] };

const jobDetailJob = {
  ...jobItem,
  required: [...jobItem.required, 'notes', 'evaluationError'],
  properties: {
    ...jobItem.properties,
    notes: { type: 'string' },
    evaluationError: { type: 'boolean' },
    posting: postingDetail,
  },
};

const actionState = {
  type: 'object',
  additionalProperties: false,
  required: ['enabled', 'reason'],
  properties: {
    enabled: { type: 'boolean' },
    reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

const jobActions = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluate', 'cv', 'letter', 'both', 'publish'],
  properties: {
    evaluate: actionState,
    cv: actionState,
    letter: actionState,
    both: actionState,
    publish: actionState,
  },
};

const jobDetailData = {
  type: 'object',
  additionalProperties: false,
  required: ['job', 'jd', 'actions', 'evaluation', 'history', 'materials', 'interviewPrep'],
  properties: {
    job: jobDetailJob,
    actions: jobActions,
    jd: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'contentHash', 'revision', 'syncedAt'],
          properties: {
            text: { type: 'string' },
            contentHash: { type: 'string' },
            revision: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
            syncedAt: dateTime,
          },
        },
      ],
    },
    evaluation: {
      type: 'object',
      additionalProperties: false,
      required: ['report', 'history'],
      properties: {
        report: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'state'],
          properties: {
            text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            state: { type: 'string', enum: ['ok', 'missing', 'invalid', 'unsafe'] },
          },
        },
        history: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'score', 'resultStatus', 'createdAt'],
            properties: {
              id: idString,
              score: { anyOf: [{ type: 'number', minimum: 0, maximum: 5 }, { type: 'null' }] },
              resultStatus: { type: 'string', enum: ['Evaluated', 'SKIP', 'Discarded'] },
              createdAt: dateTime,
            },
          },
        },
      },
    },
    history: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'oldStatus', 'newStatus', 'reason', 'actor', 'occurredAt', 'createdAt'],
        properties: {
          id: idString,
          oldStatus: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          newStatus: { type: 'string' },
          reason: { type: 'string' },
          actor: { type: 'string' },
          occurredAt: dateTimeOrNull,
          createdAt: dateTime,
        },
      },
    },
    materials: {
      type: 'object',
      additionalProperties: false,
      required: ['match', 'ambiguous', 'items'],
      properties: {
        match: { type: 'string', enum: ['id', 'legacy', 'none'] },
        ambiguous: { type: 'boolean' },
        items: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'name', 'kind', 'size', 'modifiedAt'],
            properties: {
              key: { type: 'string', enum: ['cv', 'letter', 'brief'] },
              name: { type: 'string', minLength: 1 },
              kind: { type: 'string', enum: ['pdf', 'html', 'md'] },
              size: { type: 'integer', minimum: 0 },
              modifiedAt: dateTime,
            },
          },
        },
      },
    },
    interviewPrep: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'size'],
          properties: {
            name: { type: 'string', minLength: 1 },
            size: { type: 'integer', minimum: 0 },
          },
        },
      ],
    },
  },
};

const jobMaterialParams = {
  $id: 'https://career-ops.local/schemas/JobMaterialParams',
  title: 'JobMaterialParams',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'key'],
  properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
    key: { type: 'string', enum: ['cv', 'letter', 'brief', 'prep'] },
  },
};

const selectionEntry = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'model'],
  properties: {
    provider: { type: 'string', enum: ['claude', 'codex'] },
    model: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

const runSelectionOverride = {
  type: 'object',
  additionalProperties: false,
  properties: {
    evaluation: selectionEntry,
    companyResearch: selectionEntry,
    cv: selectionEntry,
    coverLetter: selectionEntry,
  },
};

const runSelection = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...runSelectionOverride.properties,
    dryRun: { type: 'boolean' },
    company: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

const runItem = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'requestKey',
    'groupId',
    'action',
    'jobId',
    'state',
    'phase',
    'attempt',
    'exitCode',
    'errorCode',
    'createdAt',
    'startedAt',
    'updatedAt',
    'finishedAt',
    'selection',
    'source',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    requestKey: { type: 'string', minLength: 1, maxLength: 200 },
    groupId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    action: {
      type: 'string',
      enum: ['evaluate', 'cv', 'letter', 'scan', 'intake', 'publish', 'both', 'liveness'],
    },
    jobId: { anyOf: [idString, { type: 'null' }] },
    state: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'interrupted'] },
    phase: { type: 'string' },
    attempt: { type: 'integer', minimum: 1 },
    exitCode: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    errorCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    createdAt: dateTime,
    startedAt: dateTimeOrNull,
    updatedAt: dateTime,
    finishedAt: dateTimeOrNull,
    selection: runSelection,
    source: { type: 'string', enum: ['browser', 'legacy'] },
    // Present only on a run that ended LOCATION_REVIEW: the gate's reason, at most 300 characters.
    detail: { type: 'string', maxLength: 300 },
  },
};

const runRequestKey = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,160}$' };
const runCreateRequest = {
  $id: 'https://career-ops.local/schemas/RunCreateRequest',
  title: 'RunCreateRequest',
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'jobId', 'requestKey'],
      properties: {
        action: { type: 'string', enum: ['evaluate', 'cv', 'letter', 'both'] },
        jobId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
        requestKey: runRequestKey,
        selection: runSelectionOverride,
        // The user confirmed the location of a job the gate held for review. Evaluate only, one job.
        locationConfirmed: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'jobId', 'requestKey', 'expectedHash'],
      properties: {
        action: { const: 'publish' },
        jobId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
        requestKey: runRequestKey,
        expectedHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'requestKey', 'dryRun'],
      properties: {
        action: { const: 'scan' },
        requestKey: runRequestKey,
        dryRun: { type: 'boolean' },
        company: { type: 'string', minLength: 1, maxLength: 100 },
      },
    },
    {
      // Posting check: one job, or every eligible job when jobId is absent.
      type: 'object',
      additionalProperties: false,
      required: ['action', 'requestKey'],
      properties: {
        action: { const: 'liveness' },
        requestKey: runRequestKey,
        jobId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
      },
    },
  ],
};

const livenessSummaryData = {
  type: 'object',
  additionalProperties: false,
  required: ['running', 'lastFullCheck'],
  properties: {
    running: { type: 'boolean' },
    lastFullCheck: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'finishedAt',
            'checked',
            'open',
            'closed',
            'probablyClosed',
            'unknown',
            'discarded',
            'flagged',
            'heldBack',
          ],
          properties: {
            finishedAt: { type: 'string', format: 'date-time' },
            checked: { type: 'integer', minimum: 0 },
            open: { type: 'integer', minimum: 0 },
            closed: { type: 'integer', minimum: 0 },
            probablyClosed: { type: 'integer', minimum: 0 },
            unknown: { type: 'integer', minimum: 0 },
            discarded: { type: 'integer', minimum: 0 },
            // Every flag, including the held-back ones; heldBack counts only those.
            flagged: { type: 'integer', minimum: 0 },
            heldBack: { type: 'integer', minimum: 0 },
          },
        },
      ],
    },
  },
};

const letterPutRequest = {
  $id: 'https://career-ops.local/schemas/LetterPutRequest',
  title: 'LetterPutRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedHash', 'text'],
  properties: {
    expectedHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    text: { type: 'string' },
  },
};

const letterData = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'text', 'contentHash', 'pdf', 'editable'],
  properties: {
    name: { const: 'cover-letter.md' },
    text: { type: 'string' },
    // Empty only when the file is not editable (too large or not valid UTF-8).
    contentHash: { type: 'string', pattern: '^([0-9a-f]{64})?$' },
    pdf: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'modifiedAt'],
          properties: { name: { const: 'cover-letter.pdf' }, modifiedAt: dateTime },
        },
      ],
    },
    editable: { type: 'boolean' },
  },
};

const runsData = {
  type: 'object',
  additionalProperties: false,
  required: ['runs'],
  properties: { runs: { type: 'array', items: runItem } },
};

const runCreateData = {
  type: 'object',
  additionalProperties: false,
  required: ['runs', 'replayed'],
  properties: {
    runs: { type: 'array', minItems: 1, maxItems: 2, items: runItem },
    replayed: { type: 'boolean' },
  },
};

const runBatchRequest = {
  $id: 'https://career-ops.local/schemas/RunBatchRequest',
  title: 'RunBatchRequest',
  type: 'object',
  additionalProperties: false,
  required: ['requestKey'],
  oneOf: [{ required: ['jobIds'] }, { required: ['next'] }],
  properties: {
    requestKey: runRequestKey,
    jobIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
    },
    next: { type: 'integer', minimum: 1, maximum: 100 },
  },
};

const runBatchData = {
  type: 'object',
  additionalProperties: false,
  required: ['groupId', 'runs', 'skipped', 'replayed'],
  properties: {
    groupId: {
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    },
    runs: { type: 'array', minItems: 1, maxItems: 100, items: runItem },
    // A replay answers with the group's runs only; the skipped list is not stored.
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['jobId', 'reason'],
        properties: { jobId: idString, reason: { type: 'string' } },
      },
    },
    replayed: { type: 'boolean' },
  },
};

const runCancelQueuedRequest = {
  $id: 'https://career-ops.local/schemas/RunCancelQueuedRequest',
  title: 'RunCancelQueuedRequest',
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const runCancelQueuedData = {
  type: 'object',
  additionalProperties: false,
  required: ['groupId', 'cancelled'],
  properties: {
    groupId: {
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    },
    cancelled: { type: 'integer', minimum: 0 },
  },
};

const runData = {
  type: 'object',
  additionalProperties: false,
  required: ['run'],
  properties: { run: runItem },
};

const runLogData = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'offset', 'nextOffset', 'size', 'truncated'],
  properties: {
    text: { type: 'string' },
    offset: { type: 'integer', minimum: 0 },
    nextOffset: { type: 'integer', minimum: 0 },
    size: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
  },
};

const decimalString = { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$', maxLength: 40 };

const jobStatusRequest = {
  $id: 'https://career-ops.local/schemas/JobStatusRequest',
  title: 'JobStatusRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'status', 'reason'],
  properties: {
    expectedRevision: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
    status: {
      type: 'string',
      enum: ['Applied', 'Rejected', 'Interview', 'Offer', 'Pending', 'Evaluated', 'Discarded'],
    },
    reason: { type: 'string', maxLength: 200 },
  },
};

const salaryPairValue = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  properties: { min: decimalString, max: decimalString },
};
const salaryPairStored = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  properties: {
    min: { anyOf: [decimalString, { type: 'null' }] },
    max: { anyOf: [decimalString, { type: 'null' }] },
  },
};

const jobMetadataRequest = {
  $id: 'https://career-ops.local/schemas/JobMetadataRequest',
  title: 'JobMetadataRequest',
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'expectedValue', 'value'],
      properties: {
        field: { type: 'string', enum: ['company', 'role'] },
        expectedValue: { type: 'string', maxLength: 300 },
        value: { type: 'string', minLength: 1, maxLength: 300 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'expectedValue', 'value'],
      properties: {
        field: { const: 'url' },
        expectedValue: { anyOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
        value: { type: 'string', minLength: 1, maxLength: 300 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'expectedValue', 'value'],
      properties: {
        field: { const: 'salaryBand' },
        expectedValue: { anyOf: [salaryPairStored, { type: 'null' }] },
        value: { anyOf: [salaryPairValue, { type: 'null' }] },
      },
    },
  ],
};

const jobJdRequest = {
  $id: 'https://career-ops.local/schemas/JobJdRequest',
  title: 'JobJdRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'expectedHash', 'text'],
  properties: {
    expectedRevision: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
    expectedHash: { type: 'string', maxLength: 64 },
    text: { type: 'string', minLength: 1 },
  },
};

const jobFavoriteRequest = {
  $id: 'https://career-ops.local/schemas/JobFavoriteRequest',
  title: 'JobFavoriteRequest',
  type: 'object',
  additionalProperties: false,
  required: ['favorite'],
  properties: { favorite: { type: 'boolean' } },
};

const jobFavoriteData = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'favorite'],
  properties: { id: idString, favorite: { type: 'boolean' } },
};

const jobWriteData = {
  type: 'object',
  additionalProperties: false,
  required: ['job'],
  properties: { job: jobDetailJob },
};

const jobJdWriteData = {
  type: 'object',
  additionalProperties: false,
  required: ['job', 'jd', 'cacheSync'],
  properties: {
    job: jobDetailJob,
    jd: jobDetailData.properties.jd.anyOf[1],
    cacheSync: { type: 'string', enum: ['ok', 'error'] },
  },
};

const intakeTracked = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'company', 'role', 'status'],
  properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]*$' },
    company: { type: 'string' },
    role: { type: 'string' },
    status: { type: 'string' },
  },
};

const intakeSeen = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'title', 'status', 'firstSeen'],
  properties: {
    company: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string' },
    firstSeen: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

const intakeCheckRequest = {
  $id: 'https://career-ops.local/schemas/IntakeCheckRequest',
  title: 'IntakeCheckRequest',
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
};

const intakeCheckData = {
  type: 'object',
  additionalProperties: false,
  required: ['url', 'tracked', 'seen'],
  properties: {
    url: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    tracked: { anyOf: [intakeTracked, { type: 'null' }] },
    seen: { anyOf: [intakeSeen, { type: 'null' }] },
  },
};

const intakeCompaniesData = {
  type: 'object',
  additionalProperties: false,
  required: ['companies'],
  properties: { companies: { type: 'array', maxItems: 10, items: { type: 'string' } } },
};

const intakeSubmitRequest = {
  $id: 'https://career-ops.local/schemas/IntakeSubmitRequest',
  title: 'IntakeSubmitRequest',
  type: 'object',
  additionalProperties: false,
  required: ['url', 'company', 'role', 'text'],
  properties: {
    url: { type: 'string', maxLength: 2048 },
    company: { type: 'string', maxLength: 300 },
    role: { type: 'string', maxLength: 300 },
    text: { type: 'string' },
    force: { type: 'boolean' },
  },
};

const intakeFetchRequest = {
  $id: 'https://career-ops.local/schemas/IntakeFetchRequest',
  title: 'IntakeFetchRequest',
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
};

// D080: URL-first intake. The server fetches the posting (scanner resolver first, Firecrawl as
// the fallback) and returns what it could read; nulls mean "type it yourself". Nothing is
// inserted by this call.
const intakeFetchData = {
  type: 'object',
  additionalProperties: false,
  required: ['url', 'company', 'role', 'location', 'text', 'source', 'method', 'warnings'],
  properties: {
    url: { type: 'string' },
    company: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    role: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    location: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    source: { type: 'string', enum: ['resolver', 'firecrawl'] },
    method: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

// D084: Cost page. Token counts are the authority (subscription plan); estimatedUsd is what the
// same calls would cost on the providers' public API prices from config/llm-prices.json.
const costTokenFields = {
  calls: { type: 'integer', minimum: 0 },
  inputTokens: { type: 'integer', minimum: 0 },
  cachedInputTokens: { type: 'integer', minimum: 0 },
  cacheWriteTokens: { type: 'integer', minimum: 0 },
  outputTokens: { type: 'integer', minimum: 0 },
  reasoningTokens: { type: 'integer', minimum: 0 },
  totalTokens: { type: 'integer', minimum: 0 },
  estimatedUsd: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
};
const costTokenRequired = Object.keys(costTokenFields);
const costGroup = extra => ({
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(extra), ...costTokenRequired],
  // unpricedCalls: calls in this group with neither a reported cost nor a table price, so
  // estimatedUsd is a floor when it is above zero. Optional for older servers.
  // estimatedCalls (D093): calls in this group whose tokens are estimates (source 'estimate'),
  // not measurements. Optional for older servers.
  properties: {
    ...extra,
    ...costTokenFields,
    unpricedCalls: { type: 'integer', minimum: 0 },
    estimatedCalls: { type: 'integer', minimum: 0 },
  },
});
const costRange = { type: 'string', enum: ['7d', '30d', '90d', 'all'] };
const costSummaryData = {
  type: 'object',
  additionalProperties: false,
  required: [
    'range',
    'since',
    'until',
    'totals',
    'byModel',
    'byFunction',
    'byJob',
    'byDay',
    'prices',
    'unpriced',
  ],
  properties: {
    range: costRange,
    since: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    until: { type: 'string' },
    totals: costGroup({}),
    byModel: {
      type: 'array',
      items: costGroup({ provider: { type: 'string' }, model: { type: 'string' } }),
    },
    byFunction: { type: 'array', items: costGroup({ function: { type: 'string' } }) },
    byJob: {
      type: 'array',
      maxItems: 100,
      items: costGroup({
        jobId: { anyOf: [{ type: 'string', pattern: '^[1-9][0-9]*$' }, { type: 'null' }] },
        company: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        role: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      }),
    },
    byDay: {
      type: 'array',
      items: costGroup({ day: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' } }),
    },
    prices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'provider',
          'model',
          'inputUsdPerMtok',
          'cachedInputUsdPerMtok',
          'cacheWriteUsdPerMtok',
          'outputUsdPerMtok',
          'source',
        ],
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          inputUsdPerMtok: { type: 'number', minimum: 0 },
          cachedInputUsdPerMtok: { type: 'number', minimum: 0 },
          cacheWriteUsdPerMtok: { type: 'number', minimum: 0 },
          outputUsdPerMtok: { type: 'number', minimum: 0 },
          source: { type: 'string' },
        },
      },
    },
    unpriced: { type: 'array', items: { type: 'string' } },
    // D093: whether estimated rows are included in every figure of this response.
    estimates: { type: 'string', enum: ['include', 'exclude'] },
  },
};
const costCall = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'occurredAt',
    'provider',
    'model',
    'function',
    'jobId',
    'runId',
    'inputTokens',
    'cachedInputTokens',
    'cacheWriteTokens',
    'outputTokens',
    'reasoningTokens',
    'totalTokens',
    'durationMs',
    'source',
    'estimatedUsd',
  ],
  properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]*$' },
    occurredAt: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    function: { type: 'string' },
    jobId: { anyOf: [{ type: 'string', pattern: '^[1-9][0-9]*$' }, { type: 'null' }] },
    runId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    inputTokens: { type: 'integer', minimum: 0 },
    cachedInputTokens: { type: 'integer', minimum: 0 },
    cacheWriteTokens: { type: 'integer', minimum: 0 },
    outputTokens: { type: 'integer', minimum: 0 },
    reasoningTokens: { type: 'integer', minimum: 0 },
    totalTokens: { type: 'integer', minimum: 0 },
    durationMs: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    source: { type: 'string', enum: ['live', 'backfill', 'estimate'] },
    estimatedUsd: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
  },
};
const costCallsData = {
  type: 'object',
  additionalProperties: false,
  required: ['range', 'calls', 'total'],
  properties: {
    range: costRange,
    calls: { type: 'array', maxItems: 500, items: costCall },
    total: { type: 'integer', minimum: 0 },
  },
};

const intakePreviewData = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'role', 'url', 'jdPath'],
  properties: {
    company: { type: 'string' },
    role: { type: 'string' },
    url: { type: 'string' },
    jdPath: { type: 'string' },
  },
};

const intakeAddData = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'company', 'role', 'jdPath'],
  properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]*$' },
    company: { type: 'string' },
    role: { type: 'string' },
    jdPath: { type: 'string' },
  },
};

const scanReportData = {
  type: 'object',
  additionalProperties: false,
  required: ['dryRun', 'generatedAt', 'summary', 'companies', 'missing'],
  properties: {
    dryRun: { type: 'boolean' },
    generatedAt: dateTime,
    summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'structured',
        'richOnly',
        'unclassified',
        'ok',
        'empty',
        'error',
        'jobsFound',
        'newOffers',
        'missingFullJd',
      ],
      properties: Object.fromEntries(
        [
          'structured',
          'richOnly',
          'unclassified',
          'ok',
          'empty',
          'error',
          'jobsFound',
          'newOffers',
          'missingFullJd',
        ].map(name => [name, { type: 'integer', minimum: 0 }]),
      ),
    },
    companies: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'classification', 'provider', 'status', 'jobsFound', 'reason'],
        properties: {
          company: { type: 'string' },
          classification: { type: 'string' },
          provider: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          status: { type: 'string' },
          jobsFound: { type: 'integer', minimum: 0 },
          reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    missing: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'title', 'url'],
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string', format: 'uri' },
        },
      },
    },
  },
};

const providerKey = { type: 'string', enum: ['claude', 'codex'] };
const providerFunctionNames = ['evaluation', 'companyResearch', 'cv', 'coverLetter'];

const providersFunction = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'model', 'source'],
  properties: {
    provider: providerKey,
    model: { type: 'string', minLength: 1, maxLength: 80 },
    source: { type: 'string', enum: ['file', 'legacy'] },
  },
};

const providerReadinessItem = {
  type: 'object',
  additionalProperties: false,
  required: ['state', 'checkedAt', 'message'],
  properties: {
    state: { type: 'string', enum: ['unknown', 'ready', 'notLoggedIn', 'unavailable'] },
    checkedAt: dateTimeOrNull,
    message: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
  },
};

const providersReadinessMap = {
  type: 'object',
  additionalProperties: false,
  required: ['claude', 'codex'],
  properties: { claude: providerReadinessItem, codex: providerReadinessItem },
};

const providersSettingsData = {
  type: 'object',
  additionalProperties: false,
  required: ['functions', 'revision', 'readiness', 'models'],
  properties: {
    functions: {
      type: 'object',
      additionalProperties: false,
      required: providerFunctionNames,
      properties: Object.fromEntries(providerFunctionNames.map(name => [name, providersFunction])),
    },
    revision: { type: 'string', pattern: '^(legacy|[0-9a-f]{64})$' },
    readiness: providersReadinessMap,
    // D066: model ids offered per provider (defaults in providers.mjs, overridable by the
    // optional `models` map in config/llm-providers.json). Any valid id is still accepted on PUT.
    models: {
      type: 'object',
      additionalProperties: false,
      required: ['claude', 'codex'],
      properties: Object.fromEntries(
        ['claude', 'codex'].map(name => [
          name,
          {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
        ]),
      ),
    },
  },
};

const providersPutRequest = {
  $id: 'https://career-ops.local/schemas/ProvidersPutRequest',
  title: 'ProvidersPutRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'provider', 'model'],
  properties: {
    expectedRevision: { type: 'string', pattern: '^(legacy|[0-9a-f]{64})$' },
    provider: providerKey,
    model: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

const providersReadinessRequest = {
  $id: 'https://career-ops.local/schemas/ProvidersReadinessRequest',
  title: 'ProvidersReadinessRequest',
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const providersReadinessData = {
  type: 'object',
  additionalProperties: false,
  required: ['readiness'],
  properties: { readiness: providersReadinessMap },
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
  JobDetailResponse: successSchema('JobDetailResponse', jobDetailData),
  LivenessSummaryResponse: successSchema('LivenessSummaryResponse', livenessSummaryData),
  JobMaterialParams: jobMaterialParams,
  JobStatusRequest: jobStatusRequest,
  JobMetadataRequest: jobMetadataRequest,
  JobJdRequest: jobJdRequest,
  JobWriteResponse: successSchema('JobWriteResponse', jobWriteData),
  JobFavoriteRequest: jobFavoriteRequest,
  JobFavoriteResponse: successSchema('JobFavoriteResponse', jobFavoriteData),
  JobJdWriteResponse: successSchema('JobJdWriteResponse', jobJdWriteData),
  ProvidersSettingsResponse: successSchema('ProvidersSettingsResponse', providersSettingsData),
  ProvidersPutRequest: providersPutRequest,
  ProvidersReadinessRequest: providersReadinessRequest,
  ProvidersReadinessResponse: successSchema('ProvidersReadinessResponse', providersReadinessData),
  IntakeCheckRequest: intakeCheckRequest,
  IntakeCheckResponse: successSchema('IntakeCheckResponse', intakeCheckData),
  IntakeCompaniesResponse: successSchema('IntakeCompaniesResponse', intakeCompaniesData),
  IntakeSubmitRequest: intakeSubmitRequest,
  IntakeFetchRequest: intakeFetchRequest,
  IntakeFetchResponse: successSchema('IntakeFetchResponse', intakeFetchData),
  CostSummaryResponse: successSchema('CostSummaryResponse', costSummaryData),
  CostCallsResponse: successSchema('CostCallsResponse', costCallsData),
  IntakePreviewResponse: successSchema('IntakePreviewResponse', intakePreviewData),
  IntakeAddResponse: successSchema('IntakeAddResponse', intakeAddData),
  ScanReportResponse: successSchema('ScanReportResponse', scanReportData),
  LetterPutRequest: letterPutRequest,
  LetterResponse: successSchema('LetterResponse', letterData),
  RunCreateRequest: runCreateRequest,
  RunCreateResponse: successSchema('RunCreateResponse', runCreateData),
  RunBatchRequest: runBatchRequest,
  RunBatchResponse: successSchema('RunBatchResponse', runBatchData),
  RunCancelQueuedRequest: runCancelQueuedRequest,
  RunCancelQueuedResponse: successSchema('RunCancelQueuedResponse', runCancelQueuedData),
  RunsResponse: successSchema('RunsResponse', runsData),
  RunResponse: successSchema('RunResponse', runData),
  RunLogResponse: successSchema('RunLogResponse', runLogData),
  ErrorResponse: {
    $id: 'https://career-ops.local/schemas/ErrorResponse',
    title: 'ErrorResponse',
    ...errorData,
  },
});
