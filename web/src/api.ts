import type {
  ErrorResponse,
  HealthResponse,
  JobsQuery,
  JobsResponse,
  OverviewResponse,
  ReadyResponse,
  SessionResponse,
} from './generated/api';

export type EndpointState<T> =
  { kind: 'loading' } | { kind: 'success'; value: T } | { kind: 'error'; error: ApiFailure };

export class ApiFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly network: boolean;
  readonly fields?: Record<string, string>;

  constructor(
    message: string,
    code: string,
    retryable: boolean,
    requestId?: string,
    network = false,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.network = network;
    this.fields = fields;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const statuses = [
  'Pending',
  'Evaluated',
  'Applied',
  'Interview',
  'Offer',
  'Rejected',
  'Discarded',
  'Ghosted',
];
const filters = [
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
];
const sortKeys = ['score', 'statusDate', 'addedDate', 'company'];

function hasString(value: unknown): value is string {
  return typeof value === 'string';
}

function hasNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function hasCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isHttpUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isJobsQuery(value: unknown): value is JobsQuery {
  return (
    isRecord(value) &&
    hasString(value.q) &&
    Array.from(value.q).length <= 200 &&
    filters.includes(value.filter as string) &&
    sortKeys.includes(value.sort as string) &&
    (value.direction === 'asc' || value.direction === 'desc') &&
    typeof value.grouped === 'boolean' &&
    Number.isInteger(value.limit) &&
    (value.limit as number) >= 1 &&
    (value.limit as number) <= 200
  );
}

function isJobsResponse(value: unknown): value is JobsResponse {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.items)) return false;
  const data = value.data;
  const items = data.items as unknown[];
  if (
    !hasCount(data.totalCount) ||
    !hasNullableString(data.nextCursor) ||
    !hasNullableString(data.previousCursor) ||
    !isJobsQuery(data.query) ||
    items.length > 200
  )
    return false;
  return items.every(item => {
    if (!isRecord(item) || !isRecord(item.materials) || !isRecord(item.compensation)) return false;
    if (
      typeof item.id !== 'string' ||
      !/^[1-9]\d*$/.test(item.id) ||
      typeof item.revision !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(item.revision) ||
      !hasString(item.company) ||
      !hasString(item.role) ||
      !isHttpUrl(item.url) ||
      !statuses.includes(item.status as string) ||
      !(
        item.score === null ||
        (typeof item.score === 'number' &&
          Number.isFinite(item.score) &&
          item.score >= 0 &&
          item.score <= 5)
      ) ||
      !isDate(item.addedDate) ||
      !isDate(item.statusDate) ||
      !hasNullableString(item.discardReason) ||
      !(
        item.salary === null ||
        (isRecord(item.salary) &&
          (item.salary.min === null || (typeof item.salary.min === 'string' && /^\d+(\.\d+)?$/.test(item.salary.min))) &&
          (item.salary.max === null || (typeof item.salary.max === 'string' && /^\d+(\.\d+)?$/.test(item.salary.max))) &&
          item.salary.source === 'manual')
      ) ||
      !hasNullableString(item.compensation.text) ||
      !['notEvaluated', 'manual', 'report', 'missing', 'invalid'].includes(
        item.compensation.state as string,
      ) ||
      typeof item.materials.cv !== 'boolean' ||
      typeof item.materials.letter !== 'boolean'
    )
      return false;
    return true;
  });
}

function isOverviewResponse(value: unknown): value is OverviewResponse {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  if (!isRecord(data.metrics) || !isRecord(data.metrics.byStatus) || !isRecord(data.progress))
    return false;
  const metrics = data.metrics;
  const byStatus = metrics.byStatus;
  const progress = data.progress;
  if (!isRecord(byStatus)) return false;
  const statusCounts = [
    'Evaluated',
    'Applied',
    'Interview',
    'Offer',
    'Rejected',
    'Discarded',
    'Ghosted',
  ];
  const funnelLabels = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer'];
  const bucketLabels = ['4.5-5.0', '4.0-4.4', '3.5-3.9', '3.0-3.4', '  <3.0'];
  return (
    data.label === 'inferredFromCurrentState' &&
    hasCount(metrics.total) &&
    hasCount(metrics.actionable) &&
    (metrics.avgScore === null ||
      (typeof metrics.avgScore === 'number' && Number.isFinite(metrics.avgScore))) &&
    (metrics.topScore === null ||
      (typeof metrics.topScore === 'number' && Number.isFinite(metrics.topScore))) &&
    statusCounts.every(key => hasCount(byStatus[key])) &&
    Array.isArray(progress.funnel) &&
    progress.funnel.length === 5 &&
    progress.funnel.every(
      (row, index) =>
        isRecord(row) &&
        row.label === funnelLabels[index] &&
        hasCount(row.count) &&
        typeof row.percent === 'number' &&
        Number.isFinite(row.percent) &&
        row.percent >= 0 &&
        row.percent <= 100,
    ) &&
    ['responseRate', 'interviewRate', 'offerRate'].every(
      key => typeof progress[key] === 'number' && Number.isFinite(progress[key]),
    ) &&
    Array.isArray(progress.scoreBuckets) &&
    progress.scoreBuckets.length === 5 &&
    progress.scoreBuckets.every(
      (row, index) => isRecord(row) && row.label === bucketLabels[index] && hasCount(row.count),
    ) &&
    Array.isArray(progress.weeklyActivity) &&
    progress.weeklyActivity.length <= 8 &&
    progress.weeklyActivity.every(
      row => isRecord(row) && /^\d{4}-W\d{2}$/.test(String(row.week)) && hasCount(row.count),
    )
  );
}

function invalidResponse(): ApiFailure {
  return new ApiFailure(
    'The local service returned an unexpected response.',
    'INVALID_RESPONSE',
    false,
  );
}

async function read<T>(path: string, fetcher: typeof fetch, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiFailure(
      'The local service could not be reached.',
      'NETWORK_ERROR',
      true,
      undefined,
      true,
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (
    !response.ok &&
    response.status >= 500 &&
    !response.headers.get('content-type')?.toLowerCase().includes('application/json')
  ) {
    throw new ApiFailure(
      'The local service could not be reached.',
      'NETWORK_ERROR',
      true,
      undefined,
      true,
    );
  }
  if (!response.ok) {
    if (!isRecord(body) || !isRecord(body.error)) throw invalidResponse();
    const detail = body.error as ErrorResponse['error'];
    if (
      typeof detail.message !== 'string' ||
      typeof detail.code !== 'string' ||
      typeof detail.retryable !== 'boolean' ||
      typeof detail.requestId !== 'string'
    ) {
      throw invalidResponse();
    }
    throw new ApiFailure(
      detail.message,
      detail.code,
      detail.retryable,
      detail.requestId,
      false,
      isRecord(detail.fields)
        ? Object.fromEntries(
            Object.entries(detail.fields).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined,
    );
  }
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.meta)) throw invalidResponse();
  return body as T;
}

export function createApi(fetcher: typeof fetch = fetch) {
  return {
    health: (signal: AbortSignal) => read<HealthResponse>('/api/v1/health', fetcher, signal),
    ready: (signal: AbortSignal) => read<ReadyResponse>('/api/v1/ready', fetcher, signal),
    session: (signal: AbortSignal) => read<SessionResponse>('/api/v1/session', fetcher, signal),
    jobs: async (query: JobsQuery, cursor: string | null, signal: AbortSignal) => {
      const params = new URLSearchParams({
        q: query.q,
        filter: query.filter,
        sort: query.sort,
        direction: query.direction,
        grouped: String(query.grouped),
        limit: String(query.limit),
      });
      if (cursor) params.set('cursor', cursor);
      const result = await read<unknown>(`/api/v1/jobs?${params}`, fetcher, signal);
      if (!isJobsResponse(result)) throw invalidResponse();
      return result;
    },
    overview: async (signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/overview', fetcher, signal);
      if (!isOverviewResponse(result)) throw invalidResponse();
      return result;
    },
  };
}
