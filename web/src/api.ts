import type {
  ErrorResponse,
  HealthResponse,
  IntakeAddResponse,
  CostCallsResponse,
  CostSummaryResponse,
  IntakeCheckResponse,
  IntakeFetchResponse,
  IntakePreviewResponse,
  IntakeSubmitRequest,
  JobDetailResponse,
  JobFavoriteRequest,
  JobFavoriteResponse,
  ProvidersPutRequest,
  ProvidersSettingsResponse,
  RunBatchRequest,
  RunBatchResponse,
  RunCancelQueuedResponse,
  RunCreateRequest,
  ScanReportResponse,
  RunCreateResponse,
  RunLogResponse,
  RunResponse,
  RunsResponse,
  JobJdRequest,
  JobJdWriteResponse,
  JobMetadataRequest,
  JobStatusRequest,
  LetterPutRequest,
  LetterResponse,
  JobWriteResponse,
  JobsQuery,
  LivenessSummaryResponse,
  JobsResponse,
  OverviewResponse,
  ReadyResponse,
  SessionResponse,
} from './generated/api';

export type { JobDetailResponse };
export type JobItem = JobsResponse['data']['items'][number];
export type MaterialKey = 'cv' | 'letter' | 'brief' | 'prep';

export type StatusRequest = JobStatusRequest;
export type WritableStatus = JobStatusRequest['status'];
export type MetadataRequest = JobMetadataRequest;
export type JdRequest = JobJdRequest;
export type SalaryValue = { min: string | null; max: string | null };
export type DetailJob = JobDetailResponse['data']['job'];
export type JobDetailJd = NonNullable<JobDetailResponse['data']['jd']>;
export type { JobWriteResponse };
export type JdWriteResponse = JobJdWriteResponse;
export type IntakeCheck = IntakeCheckResponse['data'];
export type CostRange = CostSummaryResponse['data']['range'];
export type CostSummary = CostSummaryResponse['data'];
export type CostTotals = CostSummary['totals'];
export type CostJobRow = CostSummary['byJob'][number];
export type CostCall = CostCallsResponse['data']['calls'][number];
export type IntakeInput = IntakeSubmitRequest;
export type IntakeFetched = IntakeFetchResponse['data'];
export type IntakePreview = IntakePreviewResponse['data'];
export type IntakeResult = IntakeAddResponse['data'];
export type ScanRunRequest = Extract<RunCreateRequest, { action: 'scan' }>;
export type ScanReport = ScanReportResponse['data'];
export type ProviderSettings = ProvidersSettingsResponse['data'];
export type ProviderKey = keyof ProviderSettings['readiness'];
export type ProviderFunctionName = keyof ProviderSettings['functions'];
export type ProviderFunctionSetting = ProviderSettings['functions'][ProviderFunctionName];
export type ProviderReadiness = ProviderSettings['readiness'][ProviderKey];
export type ReadinessState = ProviderReadiness['state'];
export type ProviderSaveRequest = ProvidersPutRequest;
export const providerFunctionNames: ProviderFunctionName[] = [
  'evaluation',
  'companyResearch',
  'cv',
  'coverLetter',
];

export type JobActions = JobDetailResponse['data']['actions'];
// 3.5 added `publish` to the actions block; the 3.4 bar and dialog cover only these four.
export type JobActionKey = Exclude<keyof JobActions, 'publish'>;
export type LetterData = LetterResponse['data'];
export type LetterSaveRequest = LetterPutRequest;
export type PublishRunRequest = Extract<RunCreateRequest, { action: 'publish' }>;
export const letterPdfHref = (id: string) => `/api/v1/jobs/${encodeURIComponent(id)}/letter/pdf`;
export type JobRunRequest = Extract<
  RunCreateRequest,
  { action: 'evaluate' | 'cv' | 'letter' | 'both' }
>;
export type RunSelection = NonNullable<JobRunRequest['selection']>;

export type BatchRequest = RunBatchRequest;
export type BatchResult = RunBatchResponse['data'];
export type BatchSkip = BatchResult['skipped'][number];
export type LivenessSummary = LivenessSummaryResponse['data'];
export type LivenessRunRequest = Extract<RunCreateRequest, { action: 'liveness' }>;
export type RunRecord = RunResponse['data']['run'];
export const discoveryCodes = ['DISCOVERY_BUSY', 'DUPLICATE_JOB', 'SEEN_URL'] as const;

export const conflictCodes = [
  'REVISION_CONFLICT',
  'FIELD_CONFLICT',
  'URL_IN_USE',
  'JD_CONFLICT',
] as const;
export type ConflictCode = (typeof conflictCodes)[number];
export function conflictCode(error: unknown): ConflictCode | null {
  return error instanceof ApiFailure && (conflictCodes as readonly string[]).includes(error.code)
    ? (error.code as ConflictCode)
    : null;
}

export type EndpointState<T> =
  { kind: 'loading' } | { kind: 'success'; value: T } | { kind: 'error'; error: ApiFailure };

export class ApiFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly network: boolean;
  readonly fields?: Record<string, string>;
  readonly current?: unknown;

  constructor(
    message: string,
    code: string,
    retryable: boolean,
    requestId?: string,
    network = false,
    fields?: Record<string, string>,
    current?: unknown,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.network = network;
    this.fields = fields;
    this.current = current;
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
  'any',
];
const sortKeys = ['score', 'statusDate', 'addedDate', 'company', 'favorite', 'yoe'];
const postingStates = ['open', 'closed', 'probably_closed', 'unknown'];
const postingActions = ['none', 'flagged', 'discarded', 'held_back'];

/** The latest posting check on a job: null when never checked; detail rows add method and detail. */
function isPosting(value: unknown, detail = false): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    postingStates.includes(value.state as string) &&
    postingActions.includes(value.action as string) &&
    typeof value.checkedAt === 'string' &&
    (!detail || (typeof value.method === 'string' && typeof value.detail === 'string'))
  );
}

function isYoeFields(item: Record<string, unknown>): boolean {
  return (
    (item.yoeMin === undefined ||
      item.yoeMin === null ||
      (Number.isInteger(item.yoeMin) &&
        (item.yoeMin as number) >= 0 &&
        (item.yoeMin as number) <= 40)) &&
    (item.yoeConfidence === undefined ||
      item.yoeConfidence === null ||
      ['high', 'medium', 'low', 'inferred'].includes(item.yoeConfidence as string)) &&
    (item.posting === undefined || isPosting(item.posting))
  );
}

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
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
    );
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
    (value.limit as number) <= 200 &&
    (value.scoreMin === undefined || Number.isFinite(value.scoreMin)) &&
    (value.scoreMax === undefined || Number.isFinite(value.scoreMax)) &&
    (value.addedWeek === undefined || hasString(value.addedWeek)) &&
    (value.favorite === undefined || value.favorite === true) &&
    (value.yoeMax === undefined ||
      (Number.isInteger(value.yoeMax) &&
        (value.yoeMax as number) >= 0 &&
        (value.yoeMax as number) <= 40)) &&
    (value.yoeUnknown === undefined || value.yoeUnknown === 'exclude') &&
    (value.posting === undefined || ['expired', 'applied-closed'].includes(value.posting as string))
  );
}

function isJobItem(item: unknown): boolean {
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
        (item.salary.min === null ||
          (typeof item.salary.min === 'string' && /^\d+(\.\d+)?$/.test(item.salary.min))) &&
        (item.salary.max === null ||
          (typeof item.salary.max === 'string' && /^\d+(\.\d+)?$/.test(item.salary.max))) &&
        item.salary.source === 'manual')
    ) ||
    !hasNullableString(item.compensation.text) ||
    !['notEvaluated', 'manual', 'report', 'missing', 'invalid'].includes(
      item.compensation.state as string,
    ) ||
    typeof item.materials.cv !== 'boolean' ||
    typeof item.materials.letter !== 'boolean' ||
    !isYoeFields(item)
  )
    return false;
  return true;
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
  return items.every(isJobItem);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isDetailJob(job: unknown): boolean {
  if (!isRecord(job) || typeof job.notes !== 'string' || typeof job.evaluationError !== 'boolean')
    return false;
  const { notes: _notes, evaluationError: _error, posting, ...item } = job;
  void _notes;
  void _error;
  // The detail view's posting check also carries the method and a sentence of detail.
  return (posting === undefined || isPosting(posting, true)) && isJobItem(item);
}

function isJdRecord(jd: unknown): boolean {
  return (
    isRecord(jd) &&
    typeof jd.text === 'string' &&
    typeof jd.contentHash === 'string' &&
    typeof jd.revision === 'string' &&
    isNullableText(jd.syncedAt)
  );
}

function isJobWriteResponse(value: unknown): value is JobWriteResponse {
  return isRecord(value) && isRecord(value.data) && isDetailJob(value.data.job);
}

function isJdWriteResponse(value: unknown): value is JdWriteResponse {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    isDetailJob(value.data.job) &&
    isJdRecord(value.data.jd) &&
    (value.data.cacheSync === 'ok' || value.data.cacheSync === 'error')
  );
}

function isActionState(value: unknown): boolean {
  return isRecord(value) && typeof value.enabled === 'boolean' && strOrNull(value.reason);
}

function isJobActions(value: unknown): boolean {
  return (
    isRecord(value) && ['evaluate', 'cv', 'letter', 'both'].every(key => isActionState(value[key]))
  );
}

function isJobDetailResponse(value: unknown): value is JobDetailResponse {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  if (!isJobActions(value.data.actions)) return false;
  const { job, jd, evaluation, history, materials, interviewPrep } = value.data;
  if (!isRecord(job) || typeof job.notes !== 'string' || typeof job.evaluationError !== 'boolean')
    return false;
  if (!isDetailJob(job)) return false;
  if (
    jd !== null &&
    !(
      isRecord(jd) &&
      typeof jd.text === 'string' &&
      typeof jd.revision === 'string' &&
      isNullableText(jd.syncedAt)
    )
  )
    return false;
  if (!isRecord(evaluation) || !isRecord(evaluation.report) || !Array.isArray(evaluation.history))
    return false;
  if (
    !isNullableText(evaluation.report.text) ||
    !['ok', 'missing', 'invalid', 'unsafe'].includes(evaluation.report.state as string)
  )
    return false;
  if (
    !evaluation.history.every(
      row =>
        isRecord(row) &&
        typeof row.id === 'string' &&
        (row.score === null || typeof row.score === 'number') &&
        isNullableText(row.resultStatus) &&
        isNullableText(row.createdAt),
    )
  )
    return false;
  if (
    !Array.isArray(history) ||
    !history.every(
      row =>
        isRecord(row) &&
        typeof row.id === 'string' &&
        isNullableText(row.oldStatus) &&
        typeof row.newStatus === 'string' &&
        isNullableText(row.reason) &&
        isNullableText(row.actor) &&
        isNullableText(row.occurredAt) &&
        isNullableText(row.createdAt),
    )
  )
    return false;
  if (
    !isRecord(materials) ||
    !['id', 'legacy', 'none'].includes(materials.match as string) ||
    typeof materials.ambiguous !== 'boolean' ||
    !Array.isArray(materials.items) ||
    !materials.items.every(
      row =>
        isRecord(row) &&
        ['cv', 'letter', 'brief'].includes(row.key as string) &&
        typeof row.name === 'string' &&
        ['pdf', 'html', 'md'].includes(row.kind as string) &&
        hasCount(row.size) &&
        isNullableText(row.modifiedAt),
    )
  )
    return false;
  return (
    interviewPrep === null ||
    (isRecord(interviewPrep) &&
      typeof interviewPrep.name === 'string' &&
      hasCount(interviewPrep.size))
  );
}

const strOrNull = (value: unknown) => value === null || typeof value === 'string';

function isIntakeCheck(value: unknown): value is { data: IntakeCheck } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const { url, tracked, seen } = value.data;
  return (
    strOrNull(url) &&
    (tracked === null ||
      (isRecord(tracked) &&
        typeof tracked.id === 'string' &&
        typeof tracked.company === 'string' &&
        typeof tracked.role === 'string' &&
        typeof tracked.status === 'string')) &&
    (seen === null ||
      (isRecord(seen) &&
        typeof seen.company === 'string' &&
        typeof seen.title === 'string' &&
        typeof seen.status === 'string' &&
        strOrNull(seen.firstSeen)))
  );
}

function isCompanies(value: unknown): value is { data: { companies: string[] } } {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    Array.isArray(value.data.companies) &&
    value.data.companies.every(item => typeof item === 'string')
  );
}

function isIntakeFetched(value: unknown): value is { data: IntakeFetched } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const d = value.data;
  return (
    typeof d.url === 'string' &&
    strOrNull(d.company) &&
    strOrNull(d.role) &&
    strOrNull(d.location) &&
    strOrNull(d.text) &&
    (d.source === 'resolver' || d.source === 'firecrawl') &&
    typeof d.method === 'string' &&
    Array.isArray(d.warnings) &&
    d.warnings.every(item => typeof item === 'string')
  );
}

const costNumbers = [
  'calls',
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
] as const;

function isCostRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    costNumbers.every(key => hasCount(value[key])) &&
    (value.estimatedUsd === null ||
      (typeof value.estimatedUsd === 'number' && Number.isFinite(value.estimatedUsd)))
  );
}

function isCostSummary(value: unknown): value is CostSummaryResponse {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const d = value.data;
  const rows = (key: string, extra: (row: Record<string, unknown>) => boolean) =>
    Array.isArray(d[key]) &&
    (d[key] as unknown[]).every(row => isCostRow(row) && extra(row as Record<string, unknown>));
  return (
    ['7d', '30d', '90d', 'all'].includes(d.range as string) &&
    isCostRow(d.totals) &&
    rows('byModel', r => typeof r.provider === 'string' && typeof r.model === 'string') &&
    rows('byFunction', r => typeof r.function === 'string') &&
    rows('byJob', r => strOrNull(r.jobId) && strOrNull(r.company) && strOrNull(r.role)) &&
    rows('byDay', r => typeof r.day === 'string') &&
    Array.isArray(d.unpriced) &&
    d.unpriced.every(item => typeof item === 'string')
  );
}

function isCostCalls(value: unknown): value is CostCallsResponse {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const d = value.data;
  return (
    hasCount(d.total) &&
    Array.isArray(d.calls) &&
    d.calls.every(
      call =>
        isRecord(call) &&
        typeof call.id === 'string' &&
        typeof call.occurredAt === 'string' &&
        typeof call.provider === 'string' &&
        typeof call.model === 'string' &&
        typeof call.function === 'string' &&
        strOrNull(call.jobId) &&
        costNumbers.slice(1).every(key => hasCount(call[key])) &&
        (call.estimatedUsd === null || typeof call.estimatedUsd === 'number'),
    )
  );
}

function isIntakePreview(value: unknown): value is { data: IntakePreview } {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.data.company === 'string' &&
    typeof value.data.role === 'string' &&
    typeof value.data.url === 'string' &&
    typeof value.data.jdPath === 'string'
  );
}

function isIntakeResult(value: unknown): value is { data: IntakeResult } {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.data.id === 'string' &&
    /^[1-9]\d*$/.test(value.data.id) &&
    typeof value.data.company === 'string' &&
    typeof value.data.role === 'string' &&
    typeof value.data.jdPath === 'string'
  );
}

const summaryKeys = [
  'structured',
  'richOnly',
  'unclassified',
  'ok',
  'empty',
  'error',
  'jobsFound',
  'newOffers',
  'missingFullJd',
];

function isScanReport(value: unknown): value is { data: ScanReport } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const { dryRun, generatedAt, summary, companies, missing } = value.data;
  return (
    typeof dryRun === 'boolean' &&
    typeof generatedAt === 'string' &&
    isRecord(summary) &&
    summaryKeys.every(key => hasCount(summary[key])) &&
    Array.isArray(companies) &&
    companies.every(
      item =>
        isRecord(item) &&
        typeof item.company === 'string' &&
        typeof item.classification === 'string' &&
        strOrNull(item.provider) &&
        typeof item.status === 'string' &&
        hasCount(item.jobsFound) &&
        strOrNull(item.reason),
    ) &&
    Array.isArray(missing) &&
    missing.every(
      item =>
        isRecord(item) &&
        typeof item.company === 'string' &&
        typeof item.title === 'string' &&
        typeof item.url === 'string',
    )
  );
}

function isProviderKey(value: unknown): value is ProviderKey {
  return value === 'claude' || value === 'codex';
}

function isReadinessMap(value: unknown): value is Record<ProviderKey, ProviderReadiness> {
  return (
    isRecord(value) &&
    (['claude', 'codex'] as const).every(key => {
      const item = value[key];
      return (
        isRecord(item) &&
        ['unknown', 'ready', 'notLoggedIn', 'unavailable'].includes(item.state as string) &&
        strOrNull(item.checkedAt ?? null) &&
        strOrNull(item.message ?? null)
      );
    })
  );
}

function isFunctionMap(value: unknown): value is ProviderSettings['functions'] {
  return (
    isRecord(value) &&
    providerFunctionNames.every(name => {
      const item = value[name];
      return (
        isRecord(item) &&
        isProviderKey(item.provider) &&
        typeof item.model === 'string' &&
        (item.source === 'file' || item.source === 'legacy')
      );
    })
  );
}

function isModelList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 50 &&
    value.every(item => typeof item === 'string' && item.length > 0)
  );
}

function isProviderSettings(value: unknown): value is { data: ProviderSettings } {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    isFunctionMap(value.data.functions) &&
    typeof value.data.revision === 'string' &&
    isReadinessMap(value.data.readiness) &&
    isRecord(value.data.models) &&
    isModelList(value.data.models.claude) &&
    isModelList(value.data.models.codex)
  );
}

function isLetterResponse(value: unknown): value is LetterResponse {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return (
    data.name === 'cover-letter.md' &&
    typeof data.text === 'string' &&
    typeof data.contentHash === 'string' &&
    typeof data.editable === 'boolean' &&
    (data.pdf === null ||
      (isRecord(data.pdf) &&
        data.pdf.name === 'cover-letter.pdf' &&
        typeof data.pdf.modifiedAt === 'string'))
  );
}

function isRunRecord(run: unknown): boolean {
  return (
    isRecord(run) &&
    typeof run.id === 'string' &&
    typeof run.action === 'string' &&
    ['queued', 'running', 'completed', 'failed', 'interrupted'].includes(run.state as string) &&
    typeof run.phase === 'string' &&
    typeof run.createdAt === 'string' &&
    (run.detail === undefined || (typeof run.detail === 'string' && run.detail.length <= 300))
  );
}

function isRunResponse(value: unknown): value is RunResponse {
  return isRecord(value) && isRecord(value.data) && isRunRecord(value.data.run);
}

function isRunsResponse(value: unknown): value is RunsResponse {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    Array.isArray(value.data.runs) &&
    value.data.runs.every(isRunRecord)
  );
}

function isRunCreateResponse(value: unknown): value is RunCreateResponse {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    Array.isArray(value.data.runs) &&
    value.data.runs.length >= 1 &&
    value.data.runs.every(isRunRecord)
  );
}

function isBatchResponse(value: unknown): value is RunBatchResponse {
  const data = isRecord(value) ? value.data : undefined;
  return (
    isRecord(data) &&
    typeof data.groupId === 'string' &&
    Array.isArray(data.runs) &&
    data.runs.length >= 1 &&
    data.runs.every(isRunRecord) &&
    Array.isArray(data.skipped) &&
    data.skipped.every(
      item => isRecord(item) && typeof item.jobId === 'string' && typeof item.reason === 'string',
    ) &&
    typeof data.replayed === 'boolean'
  );
}

function isCancelQueuedResponse(value: unknown): value is RunCancelQueuedResponse {
  const data = isRecord(value) ? value.data : undefined;
  return isRecord(data) && typeof data.groupId === 'string' && hasCount(data.cancelled);
}

function isLivenessSummary(value: unknown): value is LivenessSummaryResponse {
  const data = isRecord(value) ? value.data : undefined;
  if (!isRecord(data) || typeof data.running !== 'boolean') return false;
  const last = data.lastFullCheck;
  if (last === null) return true;
  return (
    isRecord(last) &&
    typeof last.finishedAt === 'string' &&
    [
      'checked',
      'open',
      'closed',
      'probablyClosed',
      'unknown',
      'discarded',
      'flagged',
      'heldBack',
    ].every(key => hasCount(last[key]))
  );
}

function isRunLogResponse(value: unknown): value is RunLogResponse {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.data.text === 'string' &&
    hasCount(value.data.nextOffset) &&
    typeof value.data.truncated === 'boolean'
  );
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

/** Time this page was built; 'dev' under the Vite dev server and in tests. */
export const PAGE_BUILD: string = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev';
export const RELOAD_MESSAGE = 'The dashboard was updated. Reload this page.';
export const RESTART_PENDING_MESSAGE = 'A newer build is waiting for the service to restart.';

let serverBuild: string | null = null;

// The page stamp is taken before the build finishes and the service stamp is the finished file's
// time, so a current pair differs by seconds. Only a larger gap means a different build.
const BUILD_TOLERANCE_MS = 30_000;

/**
 * How this page compares with the running service: 'pageOlder' is an old tab (reloading fixes it),
 * 'serviceOlder' is a service that has not been restarted onto the newer build. 'dev' on either
 * side is never a mismatch.
 */
export function buildRelation(
  server: string | null | undefined = serverBuild,
  page: string = PAGE_BUILD,
): 'same' | 'pageOlder' | 'serviceOlder' {
  if (!server || server === 'dev' || page === 'dev') return 'same';
  const a = Date.parse(server);
  const b = Date.parse(page);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'same';
  if (a - b > BUILD_TOLERANCE_MS) return 'pageOlder';
  if (b - a > 0) return 'serviceOlder';
  return 'same';
}

export function buildMessage(relation: ReturnType<typeof buildRelation>): string | null {
  return relation === 'pageOlder'
    ? RELOAD_MESSAGE
    : relation === 'serviceOlder'
      ? RESTART_PENDING_MESSAGE
      : null;
}

function invalidResponse(): ApiFailure {
  // A page and service from different builds are the usual cause of an unexpected response.
  return new ApiFailure(
    buildMessage(buildRelation()) ?? 'The local service returned an unexpected response.',
    'INVALID_RESPONSE',
    false,
  );
}

interface WriteInit {
  method: 'POST' | 'PUT' | 'PATCH';
  body: unknown;
  nonce: string;
}

async function read<T>(
  path: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  write?: WriteInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(
      path,
      write
        ? {
            method: write.method,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'x-career-ops-session': write.nonce,
            },
            body: JSON.stringify(write.body),
            signal,
          }
        : { method: 'GET', headers: { Accept: 'application/json' }, signal },
    );
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
      detail.current,
    );
  }
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.meta)) throw invalidResponse();
  return body as T;
}

function checkedId(id: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(id))
    throw new ApiFailure(
      'This job address is not valid.',
      'INVALID_REQUEST',
      false,
      undefined,
      false,
      {
        id: 'Invalid value.',
      },
    );
  return id;
}

export function createApi(fetcher: typeof fetch = fetch) {
  return {
    health: (signal: AbortSignal) => read<HealthResponse>('/api/v1/health', fetcher, signal),
    ready: (signal: AbortSignal) => read<ReadyResponse>('/api/v1/ready', fetcher, signal),
    session: async (signal: AbortSignal) => {
      const result = await read<SessionResponse>('/api/v1/session', fetcher, signal);
      serverBuild = typeof result.data.build === 'string' ? result.data.build : null;
      return result;
    },
    jobs: async (query: JobsQuery, cursor: string | null, signal: AbortSignal) => {
      const params = new URLSearchParams({
        q: query.q,
        filter: query.filter,
        sort: query.sort,
        direction: query.direction,
        grouped: String(query.grouped),
        limit: String(query.limit),
      });
      if (query.scoreMin !== undefined) params.set('scoreMin', String(query.scoreMin));
      if (query.scoreMax !== undefined) params.set('scoreMax', String(query.scoreMax));
      if (query.addedWeek) params.set('addedWeek', query.addedWeek);
      // The server accepts only favorite=true, so the parameter is omitted when the filter is off.
      if (query.favorite) params.set('favorite', 'true');
      if (query.yoeMax !== undefined) {
        params.set('yoeMax', String(query.yoeMax));
        if (query.yoeUnknown) params.set('yoeUnknown', query.yoeUnknown);
      }
      if (query.posting) params.set('posting', query.posting);
      if (cursor) params.set('cursor', cursor);
      const result = await read<unknown>(`/api/v1/jobs?${params}`, fetcher, signal);
      if (!isJobsResponse(result)) throw invalidResponse();
      return result;
    },
    jobDetail: async (id: string, signal: AbortSignal) => {
      if (!/^[1-9][0-9]{0,18}$/.test(id))
        throw new ApiFailure(
          'This job address is not valid.',
          'INVALID_REQUEST',
          false,
          undefined,
          false,
          {
            id: 'Invalid value.',
          },
        );
      const result = await read<unknown>(`/api/v1/jobs/${id}`, fetcher, signal);
      if (!isJobDetailResponse(result)) throw invalidResponse();
      return result;
    },
    changeStatus: async (id: string, body: StatusRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>(`/api/v1/jobs/${checkedId(id)}/status`, fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isJobWriteResponse(result)) throw invalidResponse();
      return result;
    },
    // A favorite is a label: no revision, and it never changes status or score.
    setFavorite: async (id: string, favorite: boolean, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/jobs/${checkedId(id)}/favorite`,
        fetcher,
        signal,
        {
          method: 'PUT',
          body: { favorite } satisfies JobFavoriteRequest,
          nonce,
        },
      );
      const data = isRecord(result) ? result.data : undefined;
      if (!isRecord(data) || data.id !== id || typeof data.favorite !== 'boolean')
        throw invalidResponse();
      return result as JobFavoriteResponse;
    },
    changeMetadata: async (
      id: string,
      body: MetadataRequest,
      nonce: string,
      signal: AbortSignal,
    ) => {
      const result = await read<unknown>(
        `/api/v1/jobs/${checkedId(id)}/metadata`,
        fetcher,
        signal,
        { method: 'PATCH', body, nonce },
      );
      if (!isJobWriteResponse(result)) throw invalidResponse();
      return result;
    },
    saveJd: async (id: string, body: JdRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>(`/api/v1/jobs/${checkedId(id)}/jd`, fetcher, signal, {
        method: 'PUT',
        body,
        nonce,
      });
      if (!isJdWriteResponse(result)) throw invalidResponse();
      return result;
    },
    intakeCheck: async (url: string, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/intake/check', fetcher, signal, {
        method: 'POST',
        body: { url },
        nonce,
      });
      if (!isIntakeCheck(result)) throw invalidResponse();
      return result;
    },
    intakeFetch: async (url: string, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/intake/fetch', fetcher, signal, {
        method: 'POST',
        body: { url },
        nonce,
      });
      if (!isIntakeFetched(result)) throw invalidResponse();
      return result;
    },
    costSummary: async (range: CostRange, estimates: boolean, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/cost/summary?range=${encodeURIComponent(range)}&estimates=${estimates ? 'include' : 'exclude'}`,
        fetcher,
        signal,
      );
      if (!isCostSummary(result)) throw invalidResponse();
      return result;
    },
    costCalls: async (range: CostRange, limit: number, estimates: boolean, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/cost/calls?range=${encodeURIComponent(range)}&limit=${limit}&estimates=${estimates ? 'include' : 'exclude'}`,
        fetcher,
        signal,
      );
      if (!isCostCalls(result)) throw invalidResponse();
      return result;
    },
    intakeCompanies: async (q: string, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/intake/companies?q=${encodeURIComponent(q)}`,
        fetcher,
        signal,
      );
      if (!isCompanies(result)) throw invalidResponse();
      return result;
    },
    intakePreview: async (body: IntakeInput, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/intake/preview', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isIntakePreview(result)) throw invalidResponse();
      return result;
    },
    intake: async (body: IntakeInput, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/intake', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isIntakeResult(result)) throw invalidResponse();
      return result;
    },
    startScan: async (body: ScanRunRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/runs', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isRunCreateResponse(result)) throw invalidResponse();
      return result;
    },
    letter: async (id: string, signal: AbortSignal) => {
      const result = await read<unknown>(`/api/v1/jobs/${checkedId(id)}/letter`, fetcher, signal);
      if (!isLetterResponse(result)) throw invalidResponse();
      return result;
    },
    saveLetter: async (id: string, body: LetterSaveRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>(`/api/v1/jobs/${checkedId(id)}/letter`, fetcher, signal, {
        method: 'PUT',
        body,
        nonce,
      });
      if (!isLetterResponse(result)) throw invalidResponse();
      return result;
    },
    startPublish: async (body: PublishRunRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/runs', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isRunCreateResponse(result)) throw invalidResponse();
      return result;
    },
    startLiveness: async (body: LivenessRunRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/runs', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isRunCreateResponse(result)) throw invalidResponse();
      return result;
    },
    livenessSummary: async (signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/liveness/summary', fetcher, signal);
      if (!isLivenessSummary(result)) throw invalidResponse();
      return result;
    },
    startJobRun: async (body: JobRunRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/runs', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isRunCreateResponse(result)) throw invalidResponse();
      return result;
    },
    startEvaluateBatch: async (body: BatchRequest, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/runs/evaluate-batch', fetcher, signal, {
        method: 'POST',
        body,
        nonce,
      });
      if (!isBatchResponse(result)) throw invalidResponse();
      return result;
    },
    cancelQueuedRuns: async (groupId: string, nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/runs/groups/${encodeURIComponent(groupId)}/cancel-queued`,
        fetcher,
        signal,
        { method: 'POST', body: {}, nonce },
      );
      if (!isCancelQueuedResponse(result)) throw invalidResponse();
      return result;
    },
    // `limit` raises how many terminal rows come back (server default 12, at most 50). It is sent
    // only when it differs from the default.
    runs: async (signal: AbortSignal, jobId?: string, limit?: number) => {
      const query = new URLSearchParams();
      if (jobId) query.set('jobId', jobId);
      if (limit !== undefined && limit !== 12) query.set('limit', String(limit));
      const result = await read<unknown>(
        query.size ? `/api/v1/runs?${query.toString()}` : '/api/v1/runs',
        fetcher,
        signal,
      );
      if (!isRunsResponse(result)) throw invalidResponse();
      return result;
    },
    run: async (id: string, signal: AbortSignal) => {
      const result = await read<unknown>(`/api/v1/runs/${encodeURIComponent(id)}`, fetcher, signal);
      if (!isRunResponse(result)) throw invalidResponse();
      return result;
    },
    runLog: async (id: string, offset: number, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/runs/${encodeURIComponent(id)}/log?offset=${offset}`,
        fetcher,
        signal,
      );
      if (!isRunLogResponse(result)) throw invalidResponse();
      return result;
    },
    scanReport: async (id: string, signal: AbortSignal) => {
      const result = await read<unknown>(
        `/api/v1/runs/${encodeURIComponent(id)}/scan-report`,
        fetcher,
        signal,
      );
      if (!isScanReport(result)) throw invalidResponse();
      return result;
    },
    providerSettings: async (signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/settings/providers', fetcher, signal);
      if (!isProviderSettings(result)) throw invalidResponse();
      return result;
    },
    saveProvider: async (
      name: ProviderFunctionName,
      body: ProviderSaveRequest,
      nonce: string,
      signal: AbortSignal,
    ) => {
      const result = await read<unknown>(`/api/v1/settings/providers/${name}`, fetcher, signal, {
        method: 'PUT',
        body,
        nonce,
      });
      if (!isProviderSettings(result)) throw invalidResponse();
      return result;
    },
    checkProviderReadiness: async (nonce: string, signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/settings/providers/readiness', fetcher, signal, {
        method: 'POST',
        body: {},
        nonce,
      });
      const data = isRecord(result) && isRecord(result.data) ? result.data : null;
      const readiness = data && (isReadinessMap(data.readiness) ? data.readiness : data);
      if (!isReadinessMap(readiness)) throw invalidResponse();
      return readiness;
    },
    overview: async (signal: AbortSignal) => {
      const result = await read<unknown>('/api/v1/overview', fetcher, signal);
      if (!isOverviewResponse(result)) throw invalidResponse();
      return result;
    },
  };
}
