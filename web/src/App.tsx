import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { CostPage } from './CostPage';
import { ReportMarkdown } from './ReportMarkdown';
import {
  ApiFailure,
  buildMessage,
  buildRelation,
  PAGE_BUILD,
  createApi,
  type EndpointState,
  conflictCode,
  type DetailJob,
  type JobActionKey,
  type JobActions,
  type LetterData,
  letterPdfHref,
  type RunSelection,
  type IntakeCheck,
  type IntakeInput,
  type IntakePreview,
  type IntakeResult,
  type RunRecord,
  type ScanReport,
  type JobDetailJd,
  type JobDetailResponse,
  type JobItem,
  type MaterialKey,
  type MetadataRequest,
  type ProviderFunctionName,
  type ProviderFunctionSetting,
  type ProviderKey,
  type ProviderSettings,
  type ReadinessState,
  type SalaryValue,
  type WritableStatus,
} from './api';
import type {
  HealthResponse,
  JobsQuery,
  JobsResponse,
  OverviewResponse,
  ReadyResponse,
  SessionResponse,
} from './generated/api';
import './styles.css';

const pages = [
  { id: 'overview', label: 'Overview', icon: 'O' },
  { id: 'jobs', label: 'Jobs', icon: 'J' },
  { id: 'discover', label: 'Discover', icon: '+' },
  { id: 'tasks', label: 'Tasks', icon: 'T' },
  { id: 'cost', label: 'Cost', icon: '$' },
  { id: 'providers', label: 'Providers', icon: 'P' },
  { id: 'service', label: 'Service', icon: 'S' },
] as const;
type PageId = (typeof pages)[number]['id'];
type Theme = 'light' | 'dark';
const api = createApi();

const defaultJobsQuery: JobsQuery = {
  q: '',
  filter: 'all',
  sort: 'score',
  direction: 'desc',
  grouped: true,
  limit: 50,
};

function readJobsLocation() {
  const params = new URLSearchParams(location.search);
  const filters: JobsQuery['filter'][] = [
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
  const sorts: JobsQuery['sort'][] = ['score', 'statusDate', 'addedDate', 'company'];
  const filter = filters.find(value => value === params.get('filter')) ?? defaultJobsQuery.filter;
  const sort = sorts.find(value => value === params.get('sort')) ?? defaultJobsQuery.sort;
  const direction =
    params.get('direction') === 'asc'
      ? 'asc'
      : params.get('direction') === 'desc'
        ? 'desc'
        : defaultJobsQuery.direction;
  const parsedLimit = Number(params.get('limit'));
  const query: JobsQuery = {
    q: params.get('q') ?? '',
    filter,
    sort,
    direction,
    grouped: params.get('grouped') === 'false' ? false : true,
    limit:
      Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 200 ? parsedLimit : 50,
  };
  const number = (name: string) => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  };
  const scoreMin = number('scoreMin');
  const scoreMax = number('scoreMax');
  const addedWeek = params.get('addedWeek');
  if (scoreMin !== undefined) query.scoreMin = scoreMin;
  if (scoreMax !== undefined) query.scoreMax = scoreMax;
  if (addedWeek && /^\d{4}-W\d{2}$/.test(addedWeek)) query.addedWeek = addedWeek;
  return { query, cursor: params.get('cursor') };
}

function writeJobsLocation(query: JobsQuery, cursor: string | null, mode: 'push' | 'replace') {
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
  if (cursor) params.set('cursor', cursor);
  const target = `${location.pathname}?${params.toString()}${location.hash}`;
  if (mode === 'push') history.pushState(null, '', target);
  else history.replaceState(null, '', target);
}

function useJobsLocation() {
  const [state, setState] = useState(readJobsLocation);
  useEffect(() => {
    const sync = () => setState(readJobsLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const update = (query: JobsQuery, cursor: string | null, mode: 'push' | 'replace' = 'push') => {
    writeJobsLocation(query, cursor, mode);
    setState({ query, cursor });
  };
  return [state, update] as const;
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Unknown';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return /^d{4}-d{2}-d{2}$/.test(value)
    ? formatDate(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const salaryWhole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const salaryCents = new Intl.NumberFormat('en-CA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatSalary(salary: JobItem['salary']) {
  if (!salary) return null;
  // Same precision for both ends: cents only when either end has a fractional part.
  const fractional = [salary.min, salary.max].some(
    value => value !== null && !Number.isInteger(Number(value)),
  );
  const format = fractional ? salaryCents : salaryWhole;
  const part = (value: string | null) => (value === null ? null : format.format(Number(value)));
  const min = part(salary.min);
  const max = part(salary.max);
  if (min && max) return `${min} – ${max}`;
  if (min) return `from ${min}`;
  if (max) return `up to ${max}`;
  return null;
}

// One phrase per state: no evaluation yet -> "Not evaluated"; a report with no readable pay figure
// (missing or invalid) -> "Not stated".
function compensationText(job: JobItem) {
  if (job.status === 'Pending') return 'Not evaluated';
  return (
    job.compensation.text ??
    (job.compensation.state === 'missing' || job.compensation.state === 'invalid'
      ? 'Not stated'
      : 'Not evaluated')
  );
}

function scoreText(score: number | null, pending = false) {
  if (pending || score === null) return '—';
  return score.toFixed(1);
}

const statusChips: { value: JobsQuery['filter']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'evaluated', label: 'Evaluated' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'ghosted', label: 'Ghosted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'top', label: 'Top' },
  { value: 'any', label: 'Everything' },
];

// scoreMin is inclusive and scoreMax exclusive, so the label shows the bucket's own range.
function scoreFilterLabel(min: number | undefined, max: number | undefined) {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max === undefined) return `Score ${min.toFixed(1)} and above`;
  if (min === undefined && max !== undefined) return `Score below ${max.toFixed(1)}`;
  const top = Number(max) - 0.1;
  return `Score ${Number(min).toFixed(1)}-${top.toFixed(1)}`;
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(1))}%`;
}

// Score buckets and week rows on the overview open the list with the matching filter.
const bucketFilters: Record<string, { scoreMin?: number; scoreMax?: number }> = {
  '4.5-5.0': { scoreMin: 4.5 },
  '4.0-4.4': { scoreMin: 4, scoreMax: 4.5 },
  '3.5-3.9': { scoreMin: 3.5, scoreMax: 4 },
  '3.0-3.4': { scoreMin: 3, scoreMax: 3.5 },
  '<3.0': { scoreMax: 3 },
};

function listHref(params: Record<string, string>) {
  const all = new URLSearchParams({
    q: '',
    filter: 'any',
    sort: 'score',
    direction: 'desc',
    grouped: 'true',
    limit: '50',
    ...params,
  });
  return `?${all.toString()}#/jobs`;
}

// ---- Package 4.3 F31/F32, F35: the quick pair follows the job's status.
//   Pending: Evaluate | Discard      Evaluated: Apply | Discard
//   Applied: Interview | Reject      Interview: Offer | Reject      Offer: Reject
type QuickMove = 'Applied' | 'Interview' | 'Offer' | 'Rejected' | 'Discarded';
const quickNext: Record<string, 'Applied' | 'Interview' | 'Offer' | undefined> = {
  Evaluated: 'Applied',
  Applied: 'Interview',
  Interview: 'Offer',
};
const quickNextLabel: Record<string, string> = { Applied: 'Apply' };
const quickRed: Record<string, 'Reject' | 'Discard' | undefined> = {
  Pending: 'Discard',
  Evaluated: 'Discard',
  Applied: 'Reject',
  Interview: 'Reject',
  Offer: 'Reject',
};
const REJECT_CONFIRM_MS = 5000;

/** What Evaluate does from the pair: start the run, or explain why it cannot. */
interface QuickEvaluate {
  /** Reason the button is disabled, or null when it can start. */
  disabledReason: string | null;
  /** Starts the run; may throw an Error whose message is shown under the pair. */
  start: () => Promise<void> | void;
}

/** The run request the primary Evaluate button sends: the server resolves the saved settings. */
function jobRunBody(key: JobActionKey, jobId: string) {
  return { action: key, jobId, requestKey: `job-${key}-${jobId}-${crypto.randomUUID()}` } as const;
}

/** Start an evaluation with the saved per-function settings (row Evaluate; refusals become text). */
async function startEvaluation(jobId: string, nonce: string): Promise<void> {
  try {
    await api.startJobRun(jobRunBody('evaluate', jobId), nonce, new AbortController().signal);
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') return;
    if (failure instanceof ApiFailure && failure.code === 'PREREQUISITE_FAILED') {
      const next =
        isObject(failure.current) && isObject(failure.current.actions)
          ? (failure.current.actions as unknown as JobActions)
          : null;
      throw new Error(
        `Evaluate is no longer available: ${next?.evaluate?.reason ?? failure.message}`,
      );
    }
    if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED')
      throw new Error(
        'The local session is no longer valid, so nothing was started. Reload the page and try again.',
      );
    throw new Error(
      failure instanceof ApiFailure ? failure.message : 'The run could not be started.',
    );
  }
}

function QuickMoves({
  job,
  nonce,
  onMoved,
  onConflict,
  onNotice,
  evaluate,
}: {
  job: { id: string; status: string; revision: string };
  nonce: string;
  onMoved: (job: DetailJob) => void;
  /** Re-read the job (or list) after another writer changed it. */
  onConflict: () => void | Promise<unknown>;
  /** Show messages somewhere that survives this row moving to another group. */
  onNotice?: (message: string | null) => void;
  /** Present when evaluations can be dispatched from here; Pending jobs show Evaluate. */
  evaluate?: QuickEvaluate | null;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [started, setStarted] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const setNotice = (message: string | null) =>
    onNotice ? onNotice(message) : setLocalNotice(message);
  const notice = onNotice ? null : localNotice;
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  const discardButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    window.clearTimeout(timer.current);
    setConfirming(false);
    setDiscarding(false);
    setStarted(false);
  }, [job.status, job.revision]);
  const cancelDiscard = (refocus: boolean) => {
    setDiscarding(false);
    setProblem(undefined);
    if (refocus) window.requestAnimationFrame(() => discardButton.current?.focus());
  };
  // An outside press cancels the inline discard control; Escape cancels it from anywhere inside.
  useEffect(() => {
    if (!discarding) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setDiscarding(false);
      setProblem(undefined);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [discarding]);

  const next = quickNext[job.status];
  const showEvaluate = job.status === 'Pending' && Boolean(evaluate);
  const red = quickRed[job.status];
  if (!next && !showEvaluate && !red) return null;

  const move = async (status: QuickMove, reason = '') => {
    window.clearTimeout(timer.current);
    setConfirming(false);
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.changeStatus(
        job.id,
        { expectedRevision: job.revision, status, reason },
        nonce,
        new AbortController().signal,
      );
      onMoved(result.data.job);
    } catch (failure) {
      if (conflictCode(failure) === 'REVISION_CONFLICT') {
        setNotice('This job was changed elsewhere. Its current status is shown.');
        await onConflict();
      } else {
        const fields = fieldErrors(failure);
        if (status === 'Discarded' && fields.reason) setProblem(fields.reason);
        setNotice(writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  const runEvaluate = async () => {
    if (!evaluate) return;
    setBusy(true);
    setNotice(null);
    try {
      await evaluate.start();
      setStarted(true);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'The run could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDiscard = () => {
    const reason = discardReasonText(reasonChoice, reasonText);
    const found = discardProblem(reasonChoice, reason);
    setProblem(found);
    if (found) return;
    void move('Discarded', reason);
  };

  if (discarding) {
    return (
      <div
        className="quick-moves quick-discard"
        ref={root}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          cancelDiscard(true);
        }}
      >
        <DiscardFields
          choice={reasonChoice}
          text={reasonText}
          busy={busy}
          problem={problem}
          onChoice={setReasonChoice}
          onText={setReasonText}
          autoFocus
        />
        <div className="quick-moves-buttons">
          <button
            type="button"
            className="quick-move quick-move-reject"
            disabled={busy}
            onClick={confirmDiscard}
          >
            {busy ? 'Discarding…' : 'Confirm discard'}
          </button>
          <button
            type="button"
            className="quick-move"
            disabled={busy}
            onClick={() => cancelDiscard(true)}
          >
            Cancel
          </button>
        </div>
        {notice && (
          <p className="quick-move-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="quick-moves" ref={root}>
      <div className="quick-moves-buttons">
        {showEvaluate && evaluate && (
          <button
            type="button"
            className="quick-move quick-move-next"
            disabled={busy || started || evaluate.disabledReason !== null}
            aria-label="Evaluate"
            title={evaluate.disabledReason ?? undefined}
            onClick={() => void runEvaluate()}
          >
            {busy ? 'Starting…' : started ? 'Evaluating…' : 'Evaluate'}
          </button>
        )}
        {next && (
          <button
            type="button"
            className="quick-move quick-move-next"
            disabled={busy}
            aria-label={`Move to ${next}`}
            onClick={() => void move(next)}
          >
            {quickNextLabel[next] ?? next}
          </button>
        )}
        {red === 'Discard' && (
          <button
            type="button"
            ref={discardButton}
            className="quick-move quick-move-reject"
            disabled={busy}
            aria-label="Discard"
            onClick={() => {
              setNotice(null);
              setDiscarding(true);
            }}
          >
            Discard
          </button>
        )}
        {red === 'Reject' && (
          <button
            type="button"
            className={`quick-move quick-move-reject${confirming ? ' is-confirming' : ''}`}
            disabled={busy}
            aria-label={confirming ? 'Confirm reject' : 'Reject'}
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => setConfirming(false), REJECT_CONFIRM_MS);
                return;
              }
              void move('Rejected');
            }}
          >
            {confirming ? 'Confirm reject' : 'Reject'}
          </button>
        )}
      </div>
      {started && (
        <p className="quick-move-notice" role="status">
          Evaluation started. Follow it on the Tasks page.
        </p>
      )}
      {notice && (
        <p className="quick-move-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

function JobsPage({
  refreshKey,
  intake,
  writer,
  dispatch,
}: {
  refreshKey: number;
  /** Present when the server offers pasted-JD intake; Add job opens the form in a slide-out. */
  intake: { nonce: string } | null;
  /** Present when the server offers job writes; the quick status buttons follow it. */
  writer: { nonce: string } | null;
  /** Present when the server can start runs; Pending rows then offer Evaluate. */
  dispatch: { nonce: string } | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [addedTick, setAddedTick] = useState(0);
  const [locationState, updateLocation] = useJobsLocation();
  const { query, cursor } = locationState;
  const [request, setRequest] = useState<EndpointState<JobsResponse>>({ kind: 'loading' });
  const [cursorNotice, setCursorNotice] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const searchHistoryStarted = useRef(false);
  const sequence = useRef(0);
  const focusResults = useRef(false);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const summaryRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++sequence.current;
    // Keep the previous results mounted while a new page loads so focus is not lost.
    setBusy(true);
    setRequest(previous => (previous.kind === 'success' ? previous : { kind: 'loading' }));
    void api.jobs(query, cursor, controller.signal).then(
      value => {
        if (controller.signal.aborted || requestId !== sequence.current) return;
        setRequest({ kind: 'success', value });
        setBusy(false);
      },
      error => {
        if (controller.signal.aborted || requestId !== sequence.current) return;
        setBusy(false);
        if (
          error instanceof ApiFailure &&
          error.code === 'INVALID_REQUEST' &&
          error.fields?.cursor &&
          cursor
        ) {
          setCursorNotice(true);
          updateLocation(query, null, 'replace');
          return;
        }
        setRequest({
          kind: 'error',
          error:
            error instanceof ApiFailure
              ? error
              : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
        });
      },
    );
    return () => controller.abort();
  }, [
    query.q,
    query.filter,
    query.sort,
    query.direction,
    query.grouped,
    query.limit,
    query.scoreMin,
    query.scoreMax,
    query.addedWeek,
    cursor,
    retry,
    // A finished run changes what the list shows; the view inputs and the cursor stay as they are.
    refreshKey,
    // A job added from this page appears in the list without a reload.
    addedTick,
  ]);

  // "/" jumps to the search box unless the user is already typing somewhere or a dialog is open.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // After a page turn the pressed button may have been disabled or replaced; move focus to
    // the results summary so keyboard users continue from the new page.
    if (focusResults.current && request.kind === 'success' && !busy) {
      focusResults.current = false;
      summaryRef.current?.focus();
    }
  }, [request, busy]);

  // A press outside the Add job slide-out closes it (same rule as the workspace slide-outs).
  useEffect(() => {
    if (!addOpen) return;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('.ws-panel, dialog, .jobs-add-button')) return;
      const interactive = event.target.closest(
        'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      );
      setAddOpen(false);
      if (!interactive) window.requestAnimationFrame(() => addButton.current?.focus());
    };
    // Escape closes it even when focus has moved off the form (for example after a submit).
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      setAddOpen(false);
      addButton.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);
  const applyMoved = (job: DetailJob) =>
    setRequest(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: {
              ...previous.value,
              data: {
                ...previous.value.data,
                items: previous.value.data.items.map(item =>
                  item.id === job.id
                    ? {
                        ...item,
                        status: job.status,
                        statusDate: job.statusDate,
                        revision: job.revision,
                        discardReason: job.discardReason,
                      }
                    : item,
                ),
              },
            },
          }
        : previous,
    );
  const changeQuery = (patch: Partial<JobsQuery>, mode: 'push' | 'replace' = 'push') => {
    updateLocation({ ...query, ...patch }, null, mode);
    setCursorNotice(false);
  };
  const activeFilter = [
    scoreFilterLabel(query.scoreMin, query.scoreMax),
    query.addedWeek ? `Added in ${query.addedWeek}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const response = request.kind === 'success' ? request.value.data : undefined;
  const groupedItems = response?.items.reduce<Record<string, typeof response.items>>(
    (groups, item) => {
      (groups[item.status] ??= []).push(item);
      return groups;
    },
    {},
  );
  const groups = [
    'Interview',
    'Offer',
    'Applied',
    'Evaluated',
    'Ghosted',
    'Rejected',
    'Discarded',
    'Pending',
  ];

  const table = (items: NonNullable<typeof response>['items']) => (
    <div className="table-scroll" role="region" aria-label="Jobs results" tabIndex={0}>
      <table className="jobs-table">
        <caption className="visually-hidden">Jobs matching the current search and filters</caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Company and role</th>
            <th scope="col">Status</th>
            <th scope="col">Score</th>
            <th scope="col">Compensation</th>
            <th scope="col">Dates</th>
            <th scope="col" className="col-minor">
              Materials
            </th>
            <th scope="col" className="col-minor">
              Discard reason
            </th>
            {writer && <th scope="col">Move</th>}
          </tr>
        </thead>
        <tbody>
          {items.map(job => {
            const pending = job.status === 'Pending';
            const comp = compensationText(job);
            const salary = formatSalary(job.salary);
            return (
              <tr key={job.id}>
                <th scope="row" className="job-id">
                  {job.id}
                </th>
                <td className="job-name">
                  <a href={`${location.search}#/jobs/${job.id}`}>
                    <strong>{job.company || 'Company missing'}</strong>
                    <span>{job.role || 'Role missing'}</span>
                  </a>
                  <span className="task-extra">
                    {[job.materials.cv ? 'CV' : null, job.materials.letter ? 'Letter' : null]
                      .filter(Boolean)
                      .join(' + ') || 'No verified materials'}
                    {job.status === 'Discarded'
                      ? ` · Discarded: ${job.discardReason || 'No reason recorded'}`
                      : ''}
                  </span>
                </td>
                <td>
                  <span className={`job-status status-${job.status.toLowerCase()}`}>
                    {job.status}
                  </span>
                </td>
                <td>{scoreText(job.score, pending)}</td>
                <td className="compensation-cell">
                  <span>{comp}</span>
                  {salary && <small>Manual range: {salary}</small>}
                </td>
                <td className="date-cell">
                  <span>Added: {formatDate(job.addedDate)}</span>
                  <span>Status: {formatDate(job.statusDate)}</span>
                </td>
                <td className="col-minor">
                  <div className="material-badges">
                    {job.materials.cv && <span className="material-badge">CV</span>}
                    {job.materials.letter && <span className="material-badge">Letter</span>}
                    {!job.materials.cv && !job.materials.letter && (
                      <span aria-label="No verified materials">—</span>
                    )}
                  </div>
                </td>
                <td className="col-minor">
                  {job.status === 'Discarded' ? job.discardReason || 'No reason recorded' : '—'}
                </td>
                {writer && (
                  <td className="move-cell">
                    <QuickMoves
                      job={job}
                      nonce={writer.nonce}
                      onMoved={applyMoved}
                      onConflict={() => setRetry(value => value + 1)}
                      onNotice={setMoveNotice}
                      evaluate={
                        dispatch
                          ? {
                              disabledReason: null,
                              start: () => startEvaluation(job.id, dispatch.nonce),
                            }
                          : null
                      }
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <section className="jobs-toolbar" aria-label="Job list controls">
        <div className="jobs-toolbar-row">
          <h1 className="jobs-title">Jobs</h1>
          <label className="search-control">
            <span className="visually-hidden">Search jobs</span>
            <input
              ref={searchInput}
              type="search"
              aria-keyshortcuts="/"
              value={query.q}
              placeholder="Search jobs"
              onBlur={() => {
                searchHistoryStarted.current = false;
              }}
              onChange={event => {
                const mode = searchHistoryStarted.current ? 'replace' : 'push';
                searchHistoryStarted.current = true;
                changeQuery({ q: event.target.value }, mode);
              }}
            />
          </label>
          <div className="jobs-controls" role="group" aria-label="Sort and grouping">
            <label className="compact-control">
              <span>Sort by</span>
              <select
                value={query.sort}
                onChange={event => {
                  const sort = event.target.value as JobsQuery['sort'];
                  changeQuery({ sort, direction: sort === 'company' ? 'asc' : 'desc' });
                }}
              >
                <option value="score">Score</option>
                <option value="statusDate">Status date</option>
                <option value="addedDate">Added date</option>
                <option value="company">Company</option>
              </select>
            </label>
            <label className="compact-control">
              <span>Direction</span>
              <select
                value={query.direction}
                onChange={event =>
                  changeQuery({ direction: event.target.value as JobsQuery['direction'] })
                }
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
            <label className="compact-control">
              <span>Rows per page</span>
              <select
                value={query.limit}
                onChange={event => changeQuery({ limit: Number(event.target.value) })}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <label className="compact-control checkbox-control">
              <input
                type="checkbox"
                checked={query.grouped}
                onChange={event => changeQuery({ grouped: event.target.checked })}
              />{' '}
              <span>Group by status</span>
            </label>
          </div>
          {intake && (
            <button
              type="button"
              ref={addButton}
              className="primary-button jobs-add-button"
              aria-expanded={addOpen}
              aria-controls="ws-panel-add"
              onClick={() => setAddOpen(value => !value)}
            >
              Add job
            </button>
          )}
        </div>
        <div className="status-chips" role="group" aria-label="Filter by status">
          {statusChips.map(chip => (
            <button
              key={chip.value}
              type="button"
              className="status-chip"
              aria-pressed={query.filter === chip.value}
              onClick={() => changeQuery({ filter: chip.value })}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>
      {intake && (
        <SlidePanel
          id="ws-panel-add"
          title="Add a job"
          open={addOpen}
          solo
          onClose={() => {
            setAddOpen(false);
            addButton.current?.focus();
          }}
        >
          <PasteForm nonce={intake.nonce} onAdded={() => setAddedTick(value => value + 1)} />
        </SlidePanel>
      )}
      {moveNotice && (
        <div className="notice notice-warn" role="status">
          <p>{moveNotice}</p>
        </div>
      )}
      {activeFilter && (
        <p className="active-filter" role="status">
          <span>
            Showing: <strong>{activeFilter}</strong>
          </span>
          <button
            type="button"
            className="quiet-button"
            onClick={() =>
              changeQuery({ scoreMin: undefined, scoreMax: undefined, addedWeek: undefined })
            }
          >
            Clear
          </button>
        </p>
      )}
      {cursorNotice && (
        <div className="notice notice-warn" role="status">
          <p>
            This page token expired. The list reloaded from the first page with your current
            filters.
          </p>
        </div>
      )}
      {request.kind === 'loading' && (
        <section className="empty-state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading jobs…
        </section>
      )}
      {request.kind === 'error' && (
        <div className="notice notice-error" role="alert">
          <div>
            <strong>Jobs could not be loaded.</strong>
            <p>{request.error.message}</p>
          </div>
          <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {request.kind === 'success' && response && (
        <>
          <p className="results-summary" aria-live="polite" tabIndex={-1} ref={summaryRef}>
            {busy
              ? 'Updating…'
              : response.totalCount === 0
                ? 'No matching jobs'
                : `Page · ${response.items.length} shown · ${response.totalCount} matching jobs`}
          </p>
          <p className="scroll-hint">Scroll the tables sideways to see score, pay and dates.</p>
          <div className={busy ? 'results-region is-busy' : 'results-region'} aria-busy={busy}>
            {response.items.length === 0 ? (
              <section className="empty-state">
                {response.totalCount === 0 && !query.q && query.filter === 'all' ? (
                  <>
                    <h3>No jobs yet</h3>
                    <p>
                      No evaluated jobs are in the database. Pending jobs appear under the Pending
                      filter.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>
                      {response.totalCount === 0
                        ? 'No jobs match these filters'
                        : 'No jobs on this page'}
                    </h3>
                    <p>Try another search or filter.</p>
                  </>
                )}
              </section>
            ) : query.grouped && groupedItems ? (
              <div className="job-groups">
                {groups
                  .filter(status => groupedItems[status]?.length)
                  .map(status => (
                    <section className="job-group" key={status}>
                      <h3>{status}</h3>
                      {table(groupedItems[status])}
                    </section>
                  ))}
              </div>
            ) : (
              table(response.items)
            )}
          </div>
          <nav className="pagination" aria-label="Jobs pages">
            <button
              className="quiet-button"
              disabled={!response.previousCursor}
              onClick={() => {
                focusResults.current = true;
                updateLocation(query, response.previousCursor);
              }}
            >
              Previous page
            </button>
            <span>{response.totalCount} matching jobs</span>
            <button
              className="quiet-button"
              disabled={!response.nextCursor}
              onClick={() => {
                focusResults.current = true;
                updateLocation(query, response.nextCursor);
              }}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </>
  );
}

const materialLabels: Record<MaterialKey, string> = {
  cv: 'CV',
  letter: 'Cover letter',
  brief: 'Cover letter brief',
  prep: 'Interview prep',
};

const reportMessages = {
  missing: 'No evaluation report file is available for this job.',
  invalid: 'The evaluation report could not be read or is too large to show.',
  unsafe: 'The evaluation report path is outside the allowed folders, so it was not opened.',
} as const;

// The server writes one actor per change; map the known ones to what a reader understands.
const actorLabels: Record<string, string> = {
  browser: 'You (browser)',
  dashboard: 'Terminal dashboard',
  'dashboard-auto': 'Automatic ghosting',
  cli: 'Command line',
  evaluation: 'Evaluation',
  migration: 'Migration',
  scan: 'Scan',
  intake: 'Intake',
};
function actorLabel(actor: string) {
  if (!actor) return '—';
  return actorLabels[actor] ?? actor;
}

function materialHref(id: string, key: MaterialKey, name?: string) {
  return `/api/v1/jobs/${id}/materials/${key}${name ? `/${encodeURIComponent(name)}` : ''}`;
}

// ---- Package 3.2: workspace editing (status, metadata, JD). Rendered only when the session says
// jobWrites is true; nothing here starts a worker.

type DetailData = JobDetailResponse['data'];

interface EditContext {
  id: string;
  nonce: string;
  /** Re-read the job silently (no loading state) and return the fresh detail, or null on failure. */
  refresh: () => Promise<DetailData | null>;
  /** Show a job returned by a successful write straight away. */
  applyJob: (job: DetailJob) => void;
  /** Show the job and JD returned by a successful JD save without a second read. */
  applyJd: (job: DetailJob, jd: JobDetailJd) => void;
}

function writeErrorText(error: unknown): string {
  if (!(error instanceof ApiFailure)) return 'The change could not be saved.';
  if (error.code === 'LOCAL_REQUEST_REJECTED')
    return 'The local session is no longer valid, so nothing was saved. Reload the page and try again.';
  if (error.code === 'NOT_FOUND') return 'This job no longer exists.';
  return error.message;
}

function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiFailure && error.fields ? error.fields : {};
}

const writableStatuses: WritableStatus[] = [
  'Applied',
  'Rejected',
  'Interview',
  'Offer',
  'Pending',
  'Evaluated',
  'Discarded',
];
const discardReasons = [
  'Expired',
  'Seniority mismatch',
  'Wrong role',
  'Wrong location',
  'Duplicate',
  'Other',
];

// Keyboard users keep their place: the editor's first control takes focus when it opens (via
// autoFocus) and the Edit button takes it back when the editor closes.
function useReturnFocus(open: boolean) {
  const button = useRef<HTMLButtonElement | null>(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open) button.current?.focus();
    was.current = open;
  }, [open]);
  return button;
}

/** The stored reason: the chosen label, with the typed detail after it (or alone for Other). */
function discardReasonText(choice: string, detail: string): string {
  const text = detail.trim();
  if (choice === 'Other' || choice === '') return text;
  return text ? `${choice}: ${text}` : choice;
}

/** The same three messages the Status slide-out has always shown. */
function discardProblem(choice: string, reason: string): string | undefined {
  if (!choice) return 'Choose a discard reason.';
  if (!reason) return 'Add a few words for the reason.';
  if (reason.length > 200) return 'Keep the reason to 200 characters or fewer.';
  return undefined;
}

/** The discard reason choice list and details field, shared by the Status slide-out and the pair. */
function DiscardFields({
  choice,
  text,
  busy,
  problem,
  onChoice,
  onText,
  autoFocus,
}: {
  choice: string;
  text: string;
  busy: boolean;
  problem: string | undefined;
  onChoice: (value: string) => void;
  onText: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <fieldset className="edit-fieldset">
      <legend>Why is this job being discarded?</legend>
      <label>
        Reason
        <select
          value={choice}
          disabled={busy}
          autoFocus={autoFocus}
          aria-invalid={Boolean(problem) && choice === ''}
          onChange={event => onChoice(event.target.value)}
        >
          <option value="">Choose a reason…</option>
          {discardReasons.map(item => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Details {choice === 'Other' ? '(required)' : '(optional)'}
        <input
          type="text"
          value={text}
          maxLength={200}
          disabled={busy}
          onChange={event => onText(event.target.value)}
        />
      </label>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

function StatusControl({ job, ctx }: { job: DetailJob; ctx: EditContext }) {
  const [target, setTarget] = useState<WritableStatus | null>(null);
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const changed = target !== null && target !== job.status;

  const reason = target === 'Discarded' ? discardReasonText(reasonChoice, reasonText) : '';
  const validation: Record<string, string> = {};
  if (target === 'Discarded') {
    const found = discardProblem(reasonChoice, reason);
    if (found) validation.reason = found;
  }

  const confirm = async () => {
    if (!target || Object.keys(validation).length) {
      setProblems(validation);
      return;
    }
    setBusy(true);
    setError(null);
    setProblems({});
    setConflict(null);
    setDone(null);
    try {
      const result = await api.changeStatus(
        ctx.id,
        { expectedRevision: job.revision, status: target, reason },
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJob(result.data.job);
      void ctx.refresh();
      setDone(`Status changed from ${job.status} to ${target}.`);
      setTarget(null);
      setReasonChoice('');
      setReasonText('');
    } catch (failure) {
      if (conflictCode(failure) === 'REVISION_CONFLICT') {
        const fresh = await ctx.refresh();
        setConflict(
          fresh
            ? `This job was changed elsewhere. It is now ${fresh.job.status} (revision ${fresh.job.revision}). Your choice is kept below. Confirm again to apply it to the current version.`
            : 'This job was changed elsewhere. Reload the page to see the current status. Your choice is kept below.',
        );
      } else {
        setProblems(fieldErrors(failure));
        setError(writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="edit-card" aria-labelledby="status-edit-title">
      <h3 id="status-edit-title">Change status</h3>
      <p className="pane-meta">
        Current status: <strong>{job.status}</strong>
        {job.status === 'Ghosted' && ' (set automatically; choose a status to change it)'}
      </p>
      <div className="edit-row">
        <label>
          New status
          <select
            value={target ?? job.status}
            disabled={busy}
            onChange={event => {
              const next = event.target.value as WritableStatus;
              setTarget(next === job.status ? null : next);
              setDone(null);
              setError(null);
              setProblems({});
            }}
          >
            {!writableStatuses.includes(job.status as WritableStatus) && (
              <option value={job.status} disabled>
                {job.status} (automatic)
              </option>
            )}
            {writableStatuses.map(status => (
              <option key={status} value={status}>
                {status}
                {status === job.status ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {changed && target === 'Discarded' && (
        <DiscardFields
          choice={reasonChoice}
          text={reasonText}
          busy={busy}
          problem={problems.reason || validation.reason}
          onChoice={setReasonChoice}
          onText={setReasonText}
        />
      )}
      {changed && (
        <div className="edit-actions">
          <button className="primary-button" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Saving…' : `Confirm: change to ${target}`}
          </button>
          <button
            className="quiet-button"
            disabled={busy}
            onClick={() => {
              setTarget(null);
              setProblems({});
              setError(null);
              setConflict(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <p>{conflict}</p>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {done && (
        <p className="success-copy" role="status">
          {done}
        </p>
      )}
    </section>
  );
}

const textLimit = 300;

function validateText(field: 'company' | 'role' | 'url', raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'This cannot be empty.';
  if (Array.from(value).length > textLimit) return `Keep this to ${textLimit} characters or fewer.`;
  if (field === 'url') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return 'Use a link that starts with http:// or https://.';
      if (url.username || url.password) return 'Remove the username or password from the link.';
    } catch {
      return 'Enter a full link, for example https://example.com/job.';
    }
  }
  return null;
}

function TextFieldRow({
  label,
  field,
  job,
  ctx,
}: {
  label: string;
  field: 'company' | 'role' | 'url';
  job: DetailJob;
  ctx: EditContext;
}) {
  const stored = field === 'url' ? job.url : job[field];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [base, setBase] = useState<string | null>(stored);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ stored: string | null; inUse: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputId = `edit-${field}`;
  const editButton = useReturnFocus(editing);

  const start = () => {
    setDraft(stored ?? '');
    setBase(stored);
    setError(null);
    setConflict(null);
    setSaved(false);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
    setConflict(null);
  };
  const save = async () => {
    const invalid = validateText(field, draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: MetadataRequest =
        field === 'url'
          ? { field, expectedValue: base, value: draft.trim() }
          : { field, expectedValue: base ?? '', value: draft.trim() };
      const result = await api.changeMetadata(
        ctx.id,
        body,
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJob(result.data.job);
      void ctx.refresh();
      setEditing(false);
      setConflict(null);
      setSaved(true);
    } catch (failure) {
      const code = conflictCode(failure);
      if (code === 'FIELD_CONFLICT') {
        const fresh = await ctx.refresh();
        const now = fresh ? (field === 'url' ? fresh.job.url : fresh.job[field]) : null;
        setConflict({ stored: now, inUse: false });
        if (fresh) setBase(now);
      } else if (code === 'URL_IN_USE') {
        setConflict({ stored: stored, inUse: true });
      } else {
        setError(fieldErrors(failure).value ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <span className="edit-label">{label}</span>
        {!editing && (
          <button
            className="quiet-button"
            ref={editButton}
            aria-label={`Edit ${label.toLowerCase()}`}
            onClick={start}
          >
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        <p className={stored ? 'edit-value' : 'missing-copy'}>
          {stored || (field === 'url' ? 'No source link' : `${label} missing`)}
        </p>
      ) : (
        <>
          <label htmlFor={inputId} className="visually-hidden">
            {label}
          </label>
          <input
            id={inputId}
            autoFocus
            type={field === 'url' ? 'url' : 'text'}
            value={draft}
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (!busy) void save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (!busy) cancel();
              }
            }}
          />
          {error && (
            <p className="field-error" id={`${inputId}-error`} role="alert">
              {error}
            </p>
          )}
          {conflict && !conflict.inUse && (
            <div className="notice notice-warn" role="alert">
              <p>
                This {label.toLowerCase()} was changed elsewhere. Stored value now:{' '}
                <strong>{conflict.stored ?? 'empty'}</strong>. Your input is kept in the box above.
              </p>
            </div>
          )}
          {conflict?.inUse && (
            <div className="notice notice-warn" role="alert">
              <p>Another job already uses this link. Your input is kept; change it or cancel.</p>
            </div>
          )}
          <div className="edit-actions">
            <button className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : conflict && !conflict.inUse ? 'Save over stored value' : 'Save'}
            </button>
            <button className="quiet-button" disabled={busy} onClick={cancel}>
              {conflict && !conflict.inUse ? 'Use stored value' : 'Cancel'}
            </button>
          </div>
        </>
      )}
      {saved && !editing && (
        <p className="success-copy" role="status">
          {label} saved.
        </p>
      )}
    </div>
  );
}

const decimal = /^\d+(\.\d+)?$/;

function SalaryRow({ job, ctx }: { job: DetailJob; ctx: EditContext }) {
  const stored = job.salary;
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [clear, setClear] = useState(false);
  const [base, setBase] = useState<SalaryValue | null>(stored);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useReturnFocus(editing);

  const start = () => {
    setMin(stored?.min ?? '');
    setMax(stored?.max ?? '');
    setClear(false);
    setBase(stored ? { min: stored.min, max: stored.max } : null);
    setError(null);
    setConflict(null);
    setSaved(false);
    setEditing(true);
  };
  const salaryKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!busy) void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) {
        setEditing(false);
        setError(null);
        setConflict(null);
      }
    }
  };
  const save = async () => {
    let value: { min: string; max: string } | null = null;
    if (!clear) {
      const lo = min.trim();
      const hi = max.trim();
      if (!decimal.test(lo) || !decimal.test(hi)) {
        setError('Enter both amounts as plain numbers, for example 90000 and 120000.');
        return;
      }
      if (Number(lo) > Number(hi)) {
        setError('The lowest amount cannot be higher than the highest.');
        return;
      }
      value = { min: lo, max: hi };
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.changeMetadata(
        ctx.id,
        { field: 'salaryBand', expectedValue: base, value },
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJob(result.data.job);
      void ctx.refresh();
      setEditing(false);
      setConflict(null);
      setSaved(true);
    } catch (failure) {
      if (conflictCode(failure) === 'FIELD_CONFLICT') {
        const fresh = await ctx.refresh();
        const now = fresh?.job.salary ?? null;
        setConflict(now ? `${formatSalary(now) ?? 'a partial range'}` : 'no manual range');
        if (fresh) setBase(now ? { min: now.min, max: now.max } : null);
      } else {
        const fields = fieldErrors(failure);
        setError(
          fields.value ?? fields['value.min'] ?? fields['value.max'] ?? writeErrorText(failure),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <span className="edit-label">Manual salary range</span>
        {!editing && (
          <button
            className="quiet-button"
            ref={editButton}
            aria-label="Edit salary range"
            onClick={start}
          >
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        <p className={stored ? 'edit-value' : 'missing-copy'}>
          {formatSalary(stored) ?? 'No manual range'}
        </p>
      ) : (
        <>
          <div className="edit-pair">
            <label>
              Lowest
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={min}
                disabled={busy || clear}
                aria-invalid={Boolean(error)}
                onChange={event => setMin(event.target.value)}
                onKeyDown={event => salaryKeys(event)}
              />
            </label>
            <label>
              Highest
              <input
                type="text"
                inputMode="decimal"
                value={max}
                disabled={busy || clear}
                aria-invalid={Boolean(error)}
                onChange={event => setMax(event.target.value)}
                onKeyDown={event => salaryKeys(event)}
              />
            </label>
          </div>
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={clear}
              disabled={busy}
              onChange={event => setClear(event.target.checked)}
            />{' '}
            Remove the manual range
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {conflict && (
            <div className="notice notice-warn" role="alert">
              <p>
                The range was changed elsewhere. Stored value now: <strong>{conflict}</strong>. Your
                input is kept above.
              </p>
            </div>
          )}
          <div className="edit-actions">
            <button className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : conflict ? 'Save over stored value' : 'Save'}
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError(null);
                setConflict(null);
              }}
            >
              {conflict ? 'Use stored value' : 'Cancel'}
            </button>
          </div>
        </>
      )}
      {saved && !editing && (
        <p className="success-copy" role="status">
          Salary range saved.
        </p>
      )}
    </div>
  );
}

function DetailsEditor({ job, ctx }: { job: DetailJob; ctx: EditContext }) {
  return (
    <section className="edit-card" aria-labelledby="details-edit-title">
      <h3 id="details-edit-title">Edit details</h3>
      <div className="edit-grid">
        <TextFieldRow label="Company" field="company" job={job} ctx={ctx} />
        <TextFieldRow label="Role" field="role" job={job} ctx={ctx} />
        <TextFieldRow label="Source link" field="url" job={job} ctx={ctx} />
        <SalaryRow job={job} ctx={ctx} />
      </div>
    </section>
  );
}

// Unsaved JD text survives leaving the workspace within the same browser session.
const jdDrafts = new Map<string, string>();
const jdLimitBytes = 2 * 1024 * 1024;

function JdEditor({
  jd,
  ctx,
  onCacheSync,
  onEditing,
}: {
  jd: JobDetailJd | null;
  ctx: EditContext;
  onCacheSync: (state: 'ok' | 'error') => void;
  onEditing?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(() => jdDrafts.has(ctx.id));
  const [text, setText] = useState(() => jdDrafts.get(ctx.id) ?? jd?.text ?? '');
  const [restored] = useState(() => jdDrafts.has(ctx.id));
  const [base, setBase] = useState({ revision: jd?.revision ?? '0', hash: jd?.contentHash ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<JobDetailJd | null>(null);
  const [shelved, setShelved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const stored = jd?.text ?? '';
  const dirty = editing && text !== stored;
  const editButton = useReturnFocus(editing);
  useEffect(() => {
    onEditing?.(editing);
  }, [editing]);

  useEffect(() => {
    if (dirty) jdDrafts.set(ctx.id, text);
    else jdDrafts.delete(ctx.id);
  }, [dirty, text, ctx.id]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const clicks = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('#') && !href.startsWith('?') && !href.startsWith('/#')) return;
      if (
        !window.confirm(
          'You have unsaved changes to the job description. Leave this page? Your text is kept until you reload.',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', clicks, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', clicks, true);
    };
  }, [dirty]);

  const start = () => {
    setText(stored);
    setBase({ revision: jd?.revision ?? '0', hash: jd?.contentHash ?? '' });
    setError(null);
    setConflict(null);
    setShelved(null);
    setSaved(false);
    setEditing(true);
  };
  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to the job description?')) return;
    setEditing(false);
    setError(null);
    setConflict(null);
    setShelved(null);
  };
  const save = async () => {
    if (!text.trim()) {
      setError('The job description cannot be blank.');
      return;
    }
    if (new TextEncoder().encode(text).length > jdLimitBytes) {
      setError('The job description is larger than 2 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveJd(
        ctx.id,
        { expectedRevision: base.revision, expectedHash: base.hash, text },
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJd(result.data.job, result.data.jd);
      onCacheSync(result.data.cacheSync);
      setBase({ revision: result.data.jd.revision, hash: result.data.jd.contentHash });
      setEditing(false);
      setConflict(null);
      setShelved(null);
      setSaved(true);
    } catch (failure) {
      if (conflictCode(failure) === 'JD_CONFLICT') {
        const fresh = await ctx.refresh();
        if (fresh?.jd) {
          setConflict(fresh.jd);
          setBase({ revision: fresh.jd.revision, hash: fresh.jd.contentHash });
        } else {
          setError('The job description was changed elsewhere. Reload the page to see it.');
        }
      } else {
        setError(fieldErrors(failure).text ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!editing)
    return (
      <div className="edit-actions">
        <button className="quiet-button" ref={editButton} onClick={start} data-jd-edit>
          {jd ? 'Edit job description' : 'Add job description'}
        </button>
        {saved && (
          <span className="success-copy" role="status">
            Job description saved.
          </span>
        )}
      </div>
    );
  return (
    <div className="jd-editor">
      {restored && !saved && (
        <p className="pane-meta">Restored your unsaved changes from earlier in this session.</p>
      )}
      <label htmlFor="jd-text" className="visually-hidden">
        Job description text
      </label>
      <textarea
        id="jd-text"
        autoFocus
        className="doc-edit"
        value={text}
        spellCheck={false}
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'jd-error' : undefined}
        onChange={event => setText(event.target.value)}
      />
      {error && (
        <p className="field-error" id="jd-error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              The stored job description changed elsewhere (revision {conflict.revision}). Your text
              is kept in the box above and nothing was overwritten.
            </p>
            <details>
              <summary>Show the current stored text</summary>
              <pre className="doc-text conflict-text">{conflict.text}</pre>
            </details>
            <div className="edit-actions">
              {shelved === null ? (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setShelved(text);
                    setText(conflict.text);
                  }}
                >
                  Load current text (keeps my text aside)
                </button>
              ) : (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setText(shelved);
                    setShelved(null);
                  }}
                >
                  Restore my text
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : conflict ? 'Save over current version' : 'Save job description'}
        </button>
        <button
          className="quiet-button"
          disabled={busy || !dirty}
          onClick={() => {
            setText(stored);
            setError(null);
          }}
        >
          Revert
        </button>
        <button className="quiet-button" disabled={busy} onClick={close}>
          Close editor
        </button>
        {dirty && <span className="pane-meta">Unsaved changes</span>}
      </div>
    </div>
  );
}

function JdPaneEditable({
  jd,
  ctx,
  onCacheSync,
}: {
  jd: JobDetailJd | null;
  ctx: EditContext;
  onCacheSync: (state: 'ok' | 'error') => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {editing ? null : jd ? (
        <>
          <p className="pane-meta">Stored {formatDateTime(jd.syncedAt)}</p>
          <pre className="doc-text" tabIndex={0} aria-label="Job description text">
            {jd.text || 'The stored job description is empty.'}
          </pre>
        </>
      ) : (
        <p className="missing-copy">No job description is stored for this job.</p>
      )}
      <JdEditor jd={jd} ctx={ctx} onCacheSync={onCacheSync} onEditing={setEditing} />
    </>
  );
}

// ---- Package 3.4: workspace actions (Evaluate, Draft CV, Draft cover letter, Draft both).
// Shown only when the session reports taskDispatch. Nothing starts on load or navigation, and the
// score is never part of the bar or the dialog: the server decides which actions are enabled.

const actionButtons: {
  key: JobActionKey;
  label: string;
  title: string;
  functions: ProviderFunctionName[];
}[] = [
  {
    key: 'evaluate',
    label: 'Evaluate',
    title: 'Evaluate this job',
    functions: ['evaluation', 'companyResearch'],
  },
  { key: 'cv', label: 'Draft CV', title: 'Draft a CV', functions: ['cv'] },
  {
    key: 'letter',
    label: 'Draft cover letter',
    title: 'Draft a cover letter',
    functions: ['coverLetter'],
  },
  {
    key: 'both',
    label: 'Draft both',
    title: 'Draft a CV and a cover letter',
    functions: ['cv', 'coverLetter'],
  },
];
const functionLabel = (name: ProviderFunctionName) =>
  functionRows.find(row => row.key === name)?.label ?? name;
// Public run error codes in plain words. The code itself stays in a title attribute and in the
// run detail; an unknown code reads as a generic sentence.
const runErrorText: Record<string, string> = {
  EXIT_NONZERO: 'The worker ended with an error.',
  SPAWN_FAILED: 'The worker could not be started.',
  QUEUE_STALE: 'The run was queued but never started.',
  PROCESS_GONE: 'The worker stopped and the server can no longer see it.',
  STALE_24H: 'The run was last seen running more than a day ago.',
};
const errorText = (code: string) => runErrorText[code] ?? 'The run did not finish.';
const runActionLabel: Record<string, string> = {
  evaluate: 'Evaluate',
  cv: 'Draft CV',
  letter: 'Draft cover letter',
  scan: 'Scan',
  intake: 'Intake',
  publish: 'Publish',
  both: 'Draft both (legacy)',
};
const isActiveRun = (run: RunRecord) => run.state === 'queued' || run.state === 'running';

function selectionText(selection: RunRecord['selection']): string | null {
  if (!selection) return null;
  const parts = (Object.keys(selection) as ProviderFunctionName[])
    .filter(name => selection[name])
    .map(name => {
      const item = selection[name];
      return item ? `${functionLabel(name)}: ${providerLabels[item.provider]} / ${item.model}` : '';
    })
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function RunLogView({ runId, active }: { runId: string; active: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let offset = 0;
    let cancelled = false;
    setText('');
    const pull = () => {
      api.runLog(runId, offset, controller.signal).then(
        result => {
          if (cancelled) return;
          offset = result.data.nextOffset;
          setText(previous => (previous + result.data.text).slice(-20000));
        },
        () => undefined,
      );
    };
    pull();
    const timer = active ? window.setInterval(pull, 3000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      controller.abort();
    };
  }, [runId, active]);
  return (
    <pre className="doc-text log-tail" tabIndex={0} aria-label="Run log tail">
      {text || 'The log is empty so far.'}
    </pre>
  );
}

// The last non-empty log lines of a failed or interrupted run, shown without a click. It reads the
// log from the start in a few bounded pulls and keeps only the tail.
function useLastLogLines(runId: string, enabled: boolean, count = 3) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let offset = 0;
    let text = '';
    (async () => {
      try {
        for (let pass = 0; pass < 8; pass += 1) {
          const result = await api.runLog(runId, offset, controller.signal);
          text = (text + result.data.text).slice(-8000);
          if (result.data.nextOffset <= offset || !result.data.text) break;
          offset = result.data.nextOffset;
        }
        if (controller.signal.aborted) return;
        setLines(
          text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .slice(-count),
        );
      } catch {
        if (!controller.signal.aborted) setLines(null);
      }
    })();
    return () => controller.abort();
  }, [runId, enabled]);
  return lines;
}

function RunLastLines({ run }: { run: RunRecord }) {
  const failed = run.state === 'failed' || run.state === 'interrupted';
  const lines = useLastLogLines(run.id, failed);
  if (!failed || !lines || lines.length === 0) return null;
  return (
    <pre className="run-last-lines" aria-label="Last lines of the run log">
      {lines.join('\n')}
    </pre>
  );
}

function RunCard({ run }: { run: RunRecord }) {
  const [logOpen, setLogOpen] = useState(false);
  const summary = selectionText(run.selection);
  return (
    <li className="run-card" data-state={run.state}>
      <div className="run-card-head">
        <strong>{runActionLabel[run.action] ?? run.action}</strong>
        <span className={`run-badge run-${run.state}`} title={run.errorCode ?? undefined}>
          {run.state}
        </span>
      </div>
      {run.state === 'failed' && run.errorCode && (
        <p className="run-error" title={run.errorCode}>
          {errorText(run.errorCode)}
        </p>
      )}
      <RunLastLines run={run} />
      <p className="pane-meta">
        Step: {run.phase} · Attempt {run.attempt}
        {summary ? ` · ${summary}` : ''}
      </p>
      <p className="pane-meta">
        {run.startedAt
          ? `Started ${formatDateTime(run.startedAt)}`
          : `Queued ${formatDateTime(run.createdAt)}`}
        {run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ''}
      </p>
      <button className="quiet-button" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
        {logOpen ? 'Hide log' : 'Log'}
      </button>
      {run.action === 'publish' && run.state === 'completed' && run.jobId && (
        <p>
          <a href={letterPdfHref(run.jobId)} target="_blank" rel="noopener noreferrer">
            Open the PDF (draft, new tab)
          </a>
        </p>
      )}
      {logOpen && <RunLogView runId={run.id} active={isActiveRun(run)} />}
    </li>
  );
}

function ActionDialog({
  action,
  job,
  nonce,
  onClose,
  onStarted,
  onPrerequisite,
  onActive,
}: {
  action: (typeof actionButtons)[number];
  job: DetailJob;
  nonce: string;
  onClose: () => void;
  onStarted: (runs: RunRecord[]) => void;
  onPrerequisite: (actions: JobActions | null, reason: string) => void;
  onActive: (runId: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [settings, setSettings] = useState<EndpointState<ProviderSettings>>({ kind: 'loading' });
  const [overrides, setOverrides] = useState<
    Partial<Record<ProviderFunctionName, { on: boolean; provider: ProviderKey; model: string }>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    const controller = new AbortController();
    api.providerSettings(controller.signal).then(
      result => {
        if (!controller.signal.aborted) setSettings({ kind: 'success', value: result.data });
      },
      failure => {
        if (!controller.signal.aborted)
          setSettings({
            kind: 'error',
            error:
              failure instanceof ApiFailure
                ? failure
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => {
      controller.abort();
      // Closing by unmounting must still hand focus back to the button that opened the dialog.
      dialog?.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const saved = (name: ProviderFunctionName) =>
    settings.kind === 'success' ? settings.value.functions[name] : null;
  const current = (name: ProviderFunctionName) => {
    const stored = saved(name);
    return (
      overrides[name] ?? {
        on: false,
        provider: stored?.provider ?? ('claude' as ProviderKey),
        model: stored?.model ?? '',
      }
    );
  };

  const start = async () => {
    const found: Record<string, string> = {};
    const selection: RunSelection = {};
    for (const name of action.functions) {
      const item = current(name);
      if (!item.on) continue;
      const invalid = validateModel(item.model);
      if (invalid) found[name] = invalid;
      else selection[name] = { provider: item.provider, model: item.model.trim() };
    }
    setProblems(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.startJobRun(
        {
          action: action.key,
          jobId: job.id,
          requestKey: `job-${action.key}-${job.id}-${crypto.randomUUID()}`,
          ...(Object.keys(selection).length ? { selection } : {}),
        },
        nonce,
        new AbortController().signal,
      );
      onStarted(result.data.runs);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'PREREQUISITE_FAILED') {
        const actions =
          isObject(failure.current) && isObject(failure.current.actions)
            ? (failure.current.actions as unknown as JobActions)
            : null;
        onPrerequisite(actions, actions?.[action.key]?.reason ?? failure.message);
      } else if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') {
        const id =
          isObject(failure.current) && typeof failure.current.activeRunId === 'string'
            ? failure.current.activeRunId
            : null;
        onActive(id);
      } else if (failure instanceof ApiFailure && failure.code === 'PROVIDER_UNAVAILABLE') {
        // The command line tool is missing: nothing was created, so the dialog stays open.
        setError(failure.message);
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError(
          'The local session is no longer valid, so nothing was started. Reload the page and try again.',
        );
      } else if (failure instanceof ApiFailure && failure.fields) {
        setError('The run was not accepted. Check the provider and model choices.');
      } else {
        setError(failure instanceof ApiFailure ? failure.message : 'The run could not be started.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      className="dialog action-dialog"
      ref={ref}
      aria-labelledby="action-dialog-title"
      aria-describedby="action-dialog-copy"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = controls.item(0);
        const last = controls.item(controls.length - 1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="action-dialog-title" tabIndex={-1}>
        {action.title}?
      </h2>
      <p className="dialog-copy" id="action-dialog-copy">
        {job.company || 'Company missing'} – {job.role || 'Role missing'} (job #{job.id}). This
        starts a background run on your subscription command line tool and can take several minutes.
        Your saved settings are not changed.
      </p>
      {settings.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading your provider settings…
        </p>
      )}
      {settings.kind === 'error' && (
        <div className="notice notice-warn" role="status">
          <p>
            Your saved provider settings could not be read ({settings.error.message}). The run will
            use whatever the server has saved. You can still choose a provider and model below.
          </p>
        </div>
      )}
      <ul className="action-functions">
        {action.functions.map(name => {
          const stored = saved(name);
          const item = current(name);
          return (
            <li key={name} className="action-function">
              <div>
                <strong>{functionLabel(name)}</strong>
                <span className="pane-meta">
                  {stored
                    ? `Saved: ${providerLabels[stored.provider]} / ${stored.model}`
                    : 'Saved choice not shown'}
                </span>
              </div>
              {settings.kind === 'success' &&
                (() => {
                  const state = settings.value.readiness[item.provider].state;
                  return (
                    <p className="action-readiness">
                      <span className={`readiness-badge readiness-${state}`}>
                        {providerLabels[item.provider]}: {readinessText[state]}
                      </span>
                      {(state === 'notLoggedIn' || state === 'unavailable') && (
                        <span className="field-error" role="status">
                          {state === 'notLoggedIn'
                            ? `${providerLabels[item.provider]} does not look signed in on this computer, so this run may fail.`
                            : `The ${item.provider} command could not be run, so this run may fail.`}{' '}
                          You can still start it.
                        </span>
                      )}
                    </p>
                  );
                })()}
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={item.on}
                  disabled={busy}
                  onChange={event =>
                    setOverrides(previous => ({
                      ...previous,
                      [name]: { ...item, on: event.target.checked },
                    }))
                  }
                />{' '}
                Use a different provider or model for this run only
              </label>
              {item.on && (
                <div className="provider-fields action-override">
                  <label>
                    Provider
                    <select
                      value={item.provider}
                      disabled={busy}
                      onChange={event => {
                        const next = event.target.value as ProviderKey;
                        setOverrides(previous => ({
                          ...previous,
                          [name]: {
                            ...item,
                            provider: next,
                            model: modelAfterProviderChange(
                              settings.kind === 'success' ? settings.value.models : undefined,
                              next,
                              item.model,
                            ),
                          },
                        }));
                      }}
                    >
                      <option value="claude">Claude</option>
                      <option value="codex">OpenAI</option>
                    </select>
                  </label>
                  <ModelField
                    id={`override-${name}`}
                    provider={item.provider}
                    models={settings.kind === 'success' ? settings.value.models : undefined}
                    value={item.model}
                    disabled={busy}
                    invalid={Boolean(problems[name])}
                    onChange={next =>
                      setOverrides(previous => ({
                        ...previous,
                        [name]: { ...item, model: next },
                      }))
                    }
                  />
                  {problems[name] && (
                    <p className="field-error" role="alert">
                      {problems[name]}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start'}
        </button>
        <button className="quiet-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

// ---- Package 3.5: cover-letter editor and Publish PDF.
// Saving never publishes, publishing never regenerates text and nothing starts on load. The editor
// needs jobWrites; Publish PDF needs taskDispatch. The PDF is always labelled a draft.

const letterDrafts = new Map<string, string>();
const letterLimitBytes = 256 * 1024;
const normalizeLetter = (text: string) => text.replace(/\r\n?/g, '\n');

type LetterState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: LetterData };

function useLetter(id: string, wanted: boolean, stamp: string) {
  const [state, setState] = useState<LetterState>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!wanted) {
      setState({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState(previous => (previous.kind === 'ok' ? previous : { kind: 'loading' }));
    api.letter(id, controller.signal).then(
      result => {
        if (!controller.signal.aborted) setState({ kind: 'ok', data: result.data });
      },
      failure => {
        if (controller.signal.aborted) return;
        // A failed refresh never replaces a letter that was already read.
        setState(previous =>
          previous.kind === 'ok'
            ? previous
            : {
                kind: 'error',
                message:
                  failure instanceof ApiFailure ? failure.message : 'The letter could not be read.',
              },
        );
      },
    );
    return () => controller.abort();
  }, [id, wanted, stamp, tick]);
  return {
    state,
    reload: () => setTick(value => value + 1),
    apply: (data: LetterData) => setState({ kind: 'ok', data }),
  };
}

function useLeaveGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const clicks = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('#') && !href.startsWith('?') && !href.startsWith('/#')) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', clicks, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', clicks, true);
    };
  }, [dirty, message]);
}

function LetterEditor({
  id,
  nonce,
  letter,
  onApply,
  onDirty,
  onReload,
  dialog = false,
  onClosed,
}: {
  id: string;
  nonce: string;
  letter: LetterData;
  onApply: (data: LetterData) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
  /** Inside the letter modal: starts editing, stays open after a save, Cancel closes the modal. */
  dialog?: boolean;
  onClosed?: () => void;
}) {
  const stored = normalizeLetter(letter.text);
  const [editing, setEditing] = useState(() => dialog || letterDrafts.has(id));
  const [text, setText] = useState(() => letterDrafts.get(id) ?? stored);
  const [restored] = useState(() => letterDrafts.has(id));
  const [base, setBase] = useState(letter.contentHash);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ text: string; contentHash: string } | null>(null);
  const [shelved, setShelved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = editing && text !== stored;
  const editButton = useReturnFocus(editing);

  useEffect(() => {
    if (dirty) letterDrafts.set(id, text);
    else letterDrafts.delete(id);
  }, [dirty, text, id]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  useLeaveGuard(
    dirty,
    'You have unsaved changes to the cover letter. Leave this page? Your text is kept until you reload.',
  );

  const start = () => {
    setText(stored);
    setBase(letter.contentHash);
    setError(null);
    setConflict(null);
    setShelved(null);
    setSaved(false);
    setEditing(true);
  };
  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to the cover letter?')) return;
    if (dialog) letterDrafts.delete(id);
    setEditing(false);
    setError(null);
    setConflict(null);
    setShelved(null);
    onClosed?.();
  };
  const save = async () => {
    if (!text.trim()) {
      setError('The cover letter cannot be blank.');
      return;
    }
    if (new TextEncoder().encode(text).length > letterLimitBytes) {
      setError('The cover letter is larger than 256 KB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveLetter(
        id,
        { expectedHash: base, text },
        nonce,
        new AbortController().signal,
      );
      onApply(result.data);
      setBase(result.data.contentHash);
      if (!dialog) setEditing(false);
      setConflict(null);
      setShelved(null);
      setSaved(true);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'LETTER_CONFLICT') {
        const current =
          isObject(failure.current) &&
          typeof failure.current.text === 'string' &&
          typeof failure.current.contentHash === 'string'
            ? { text: failure.current.text, contentHash: failure.current.contentHash }
            : null;
        if (current) {
          setConflict(current);
          setBase(current.contentHash);
        } else {
          setError('The cover letter was changed elsewhere. Reload the page to see it.');
        }
      } else if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') {
        setError(
          'A letter or publish run for this job is active, so nothing was saved. Try again when it finishes. Your text is kept.',
        );
      } else if (failure instanceof ApiFailure && failure.code === 'LETTER_NOT_EDITABLE') {
        setError('This cover letter cannot be edited here. Your text is kept.');
        onReload();
      } else {
        setError(fieldErrors(failure).text ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!editing && dialog) return null;
  if (!editing)
    return (
      <div className="edit-actions">
        <button className="quiet-button" ref={editButton} onClick={start}>
          Edit cover letter
        </button>
        {saved && (
          <span className="success-copy" role="status">
            Cover letter saved. The PDF was not changed; use Publish PDF to render it.
          </span>
        )}
      </div>
    );
  return (
    <div className="jd-editor letter-editor">
      {restored && !saved && (
        <p className="pane-meta">Restored your unsaved changes from earlier in this session.</p>
      )}
      <label htmlFor="letter-text" className="visually-hidden">
        Cover letter text
      </label>
      <textarea
        id="letter-text"
        autoFocus
        className="doc-edit"
        value={text}
        spellCheck
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'letter-error' : undefined}
        onChange={event => setText(event.target.value)}
      />
      {error && (
        <p className="field-error" id="letter-error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              The saved cover letter changed elsewhere. Your text is kept in the box above and
              nothing was overwritten.
            </p>
            <details>
              <summary>Show the current saved text</summary>
              <pre className="doc-text conflict-text">{normalizeLetter(conflict.text)}</pre>
            </details>
            <div className="edit-actions">
              {shelved === null ? (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setShelved(text);
                    setText(normalizeLetter(conflict.text));
                  }}
                >
                  Load current text (keeps my text aside)
                </button>
              ) : (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setText(shelved);
                    setShelved(null);
                  }}
                >
                  Restore my text
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : conflict ? 'Save over current version' : 'Save cover letter'}
        </button>
        <button
          className="quiet-button"
          disabled={busy || !dirty}
          onClick={() => {
            setText(stored);
            setError(null);
          }}
        >
          Revert
        </button>
        <button className="quiet-button" disabled={busy} onClick={close}>
          {dialog ? 'Cancel' : 'Close editor'}
        </button>
        {dirty && <span className="pane-meta">Unsaved changes</span>}
        {dialog && saved && !dirty && (
          <span className="success-copy" role="status">
            Saved. The PDF was not changed; use Publish PDF to render it.
          </span>
        )}
      </div>
    </div>
  );
}

function LetterSection({
  jobId,
  letter,
  writer,
  onApply,
  onDirty,
  onReload,
}: {
  jobId: string;
  letter: LetterState;
  writer: { nonce: string } | null;
  onApply: (data: LetterData) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
}) {
  if (letter.kind === 'idle') return null;
  return (
    <div className="letter-section" role="group" aria-label="Cover letter editor and PDF">
      {letter.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading the cover letter…
        </p>
      )}
      {letter.kind === 'error' && (
        <p className="missing-copy">
          The cover letter could not be loaded. Reload the page to try again.
        </p>
      )}
      {letter.kind === 'ok' && (
        <>
          {writer && letter.data.editable && (
            <LetterEditor
              id={jobId}
              nonce={writer.nonce}
              letter={letter.data}
              onApply={onApply}
              onDirty={onDirty}
              onReload={onReload}
            />
          )}
          {!letter.data.editable && (
            <p className="missing-copy">
              This cover letter is too large or not valid text, so it cannot be edited here.
            </p>
          )}
          {letter.data.pdf ? (
            <p className="letter-pdf">
              <strong>Cover letter PDF (draft)</strong>
              <span>
                {letter.data.pdf.name} · Modified {formatDateTime(letter.data.pdf.modifiedAt)} · A
                draft for your review, not sent to anyone.
              </span>{' '}
              <a href={letterPdfHref(jobId)} target="_blank" rel="noopener noreferrer">
                Open PDF (new tab)
              </a>
            </p>
          ) : (
            <p className="pane-meta">No PDF has been published for this letter yet.</p>
          )}
        </>
      )}
    </div>
  );
}

/** F39: the header's Cover letter cell opens this plain-text editor in a centered native dialog. */
function LetterModal({
  jobId,
  letter,
  writer,
  fileHref,
  fileName,
  canPublish,
  publishNote,
  onPublish,
  onApply,
  onDirty,
  onReload,
  onClose,
}: {
  jobId: string;
  letter: LetterData;
  writer: { nonce: string } | null;
  fileHref: string;
  fileName: string;
  /** Publish PDF is offered when a dispatch capability exists. */
  canPublish: boolean;
  /** Why Publish PDF cannot start right now, or null. */
  publishNote: string | null;
  onPublish: () => void;
  onApply: (data: LetterData) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  const requestClose = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to the cover letter?')) return;
    if (dirty) letterDrafts.delete(jobId);
    onClose();
  };
  const editable = Boolean(writer) && letter.editable;
  return (
    <dialog
      className="dialog letter-modal"
      ref={ref}
      aria-labelledby="letter-modal-title"
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={trapTab}
    >
      <div className="letter-modal-head">
        <h2 id="letter-modal-title">Cover letter</h2>
        <button
          type="button"
          className="quiet-button dialog-close"
          aria-label="Close the cover letter"
          onClick={requestClose}
        >
          ×
        </button>
      </div>
      {editable && writer ? (
        <LetterEditor
          id={jobId}
          nonce={writer.nonce}
          letter={letter}
          onApply={onApply}
          onDirty={value => {
            setDirty(value);
            onDirty(value);
          }}
          onReload={onReload}
          dialog
          onClosed={onClose}
        />
      ) : (
        <>
          <p className="pane-meta">
            {letter.editable
              ? 'Editing is not available in this session.'
              : 'This cover letter is too large or not valid text, so it cannot be edited here.'}
          </p>
          {letter.editable && (
            <pre className="doc-text letter-modal-read">{normalizeLetter(letter.text)}</pre>
          )}
          <div className="edit-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
      <div className="letter-modal-foot">
        {canPublish && (
          <button
            type="button"
            className="quiet-button"
            disabled={publishNote !== null}
            aria-describedby={publishNote ? 'letter-modal-publish-note' : undefined}
            onClick={onPublish}
          >
            Publish PDF
          </button>
        )}
        {canPublish && publishNote && (
          <span className="pane-meta" id="letter-modal-publish-note">
            {publishNote}
          </span>
        )}
        <a className="letter-modal-file" href={fileHref} target="_blank" rel="noopener noreferrer">
          Open file ({fileName}, new tab)
        </a>
      </div>
    </dialog>
  );
}

function PublishDialog({
  job,
  hash,
  hasPdf,
  nonce,
  onClose,
  onStarted,
  onPrerequisite,
  onActive,
  onConflict,
}: {
  job: DetailJob;
  hash: string;
  hasPdf: boolean;
  nonce: string;
  onClose: () => void;
  onStarted: (runs: RunRecord[]) => void;
  onPrerequisite: (actions: JobActions | null, reason: string) => void;
  onActive: (runId: string | null) => void;
  onConflict: (current: { text: string; contentHash: string } | null) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.startPublish(
        {
          action: 'publish',
          jobId: job.id,
          requestKey: `job-publish-${job.id}-${crypto.randomUUID()}`,
          expectedHash: hash,
        },
        nonce,
        new AbortController().signal,
      );
      onStarted(result.data.runs);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'LETTER_CONFLICT') {
        onConflict(
          isObject(failure.current) &&
            typeof failure.current.text === 'string' &&
            typeof failure.current.contentHash === 'string'
            ? { text: failure.current.text, contentHash: failure.current.contentHash }
            : null,
        );
      } else if (failure instanceof ApiFailure && failure.code === 'PREREQUISITE_FAILED') {
        const actions =
          isObject(failure.current) && isObject(failure.current.actions)
            ? (failure.current.actions as unknown as JobActions)
            : null;
        onPrerequisite(actions, actions?.publish?.reason ?? failure.message);
      } else if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') {
        onActive(
          isObject(failure.current) && typeof failure.current.activeRunId === 'string'
            ? failure.current.activeRunId
            : null,
        );
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError('The local session is no longer valid, so nothing was started. Reload the page.');
      } else {
        setError(
          failure instanceof ApiFailure ? failure.message : 'The PDF could not be published.',
        );
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      className="dialog action-dialog"
      ref={ref}
      aria-labelledby="publish-dialog-title"
      aria-describedby="publish-dialog-copy"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={trapTab}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="publish-dialog-title">Publish the cover letter PDF?</h2>
      <p className="pane-meta" id="publish-dialog-copy">
        {job.company || 'Company missing'} – {job.role || 'Role missing'} (job #{job.id}). This
        renders the saved cover-letter.md to cover-letter.pdf in the job folder
        {hasPdf ? ' and replaces the earlier PDF there' : ''}. The PDF is a draft for your review.
        Nothing is sent or submitted, the text is not changed, and no provider is used.
      </p>
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start'}
        </button>
        <button className="quiet-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

function JobActionsPanel({
  job,
  actions,
  nonce,
  refresh,
  letterHash,
  letterHasPdf,
  letterNote,
  letterDirty,
  onLetterConflict,
  onRunsEnded,
  runsHost,
  evaluateRequest,
  evaluateDialogRequest,
  hasReport,
  onInlineIssue,
  onInlineStarted,
  headerRequest,
  onHeaderIssue,
  onActiveActions,
}: {
  /** Counter and key bumped by the header's Draft and Publish buttons; same path as the buttons below. */
  headerRequest: { key: 'cv' | 'letter' | 'publish'; n: number };
  /** Why a header button could not start its run (null clears it). */
  onHeaderIssue: (message: string | null) => void;
  /** The actions that have an active run for this job, so the header can show "Drafting…". */
  onActiveActions: (keys: string[]) => void;
  runsHost: HTMLElement | null;
  /** Counter bumped by the report pane's inline button; opens the Evaluate dialog. */
  evaluateRequest: number;
  /** Counter bumped by the report pane's "with model" button; opens the chooser. */
  evaluateDialogRequest: number;
  hasReport: boolean;
  /** Tells the report pane why its Evaluate button could not start a run (null clears it). */
  onInlineIssue: (message: string | null) => void;
  /** The report pane's Evaluate started a run; show it. */
  onInlineStarted: () => void;

  job: DetailJob;
  actions: JobActions;
  nonce: string;
  refresh: () => Promise<DetailData | null>;
  /** Hash of the saved cover letter, or null when it cannot be published from here. */
  letterHash: string | null;
  letterHasPdf: boolean;
  letterNote: string;
  letterDirty: boolean;
  onLetterConflict: (current: { text: string; contentHash: string } | null) => void;
  onRunsEnded: () => void;
}) {
  const [dialog, setDialog] = useState<JobActionKey | 'publish' | null>(null);
  const [directBusy, setDirectBusy] = useState<JobActionKey | null>(null);
  const [override, setOverride] = useState<JobActions | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const wasActive = useRef(false);
  const active = runs.some(isActiveRun);
  const live = override ?? actions;

  // A fresh detail read replaces any server-corrected action state.
  useEffect(() => setOverride(null), [actions]);

  // The report pane's inline Evaluate button asks for the same dialog as the button below.
  const seenRequest = useRef(evaluateRequest);
  useEffect(() => {
    if (evaluateRequest === seenRequest.current) return;
    seenRequest.current = evaluateRequest;
    if (live.evaluate.enabled) void startDirect('evaluate', 'inline');
  }, [evaluateRequest]);
  const seenHeader = useRef(headerRequest.n);
  useEffect(() => {
    if (headerRequest.n === seenHeader.current) return;
    seenHeader.current = headerRequest.n;
    const key = headerRequest.key;
    onHeaderIssue(null);
    if (key === 'publish') {
      if (publishReason !== null) onHeaderIssue(publishReason);
      else setDialog('publish');
      return;
    }
    if (!live[key].enabled) {
      onHeaderIssue(`That action is not available: ${live[key].reason ?? 'try again later.'}`);
      return;
    }
    void startDirect(key, 'header');
  }, [headerRequest.n]);
  useEffect(() => {
    const keys = new Set<string>();
    for (const run of runs) {
      if (!isActiveRun(run)) continue;
      if (run.action === 'both') {
        keys.add('cv');
        keys.add('letter');
      } else keys.add(run.action);
    }
    onActiveActions([...keys]);
  }, [runs]);
  const seenDialogRequest = useRef(evaluateDialogRequest);
  useEffect(() => {
    if (evaluateDialogRequest === seenDialogRequest.current) return;
    seenDialogRequest.current = evaluateDialogRequest;
    if (live.evaluate.enabled) {
      setNotice(null);
      onInlineIssue(null);
      setDialog('evaluate');
    }
  }, [evaluateDialogRequest]);

  const sorted = (list: RunRecord[]) =>
    [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    const controller = new AbortController();
    api.runs(controller.signal, job.id).then(
      result => {
        if (controller.signal.aborted) return;
        setRuns(sorted(result.data.runs));
        setLoaded(true);
      },
      failure => {
        if (controller.signal.aborted) return;
        setReadError(
          failure instanceof ApiFailure ? failure.message : 'The runs could not be read.',
        );
        setLoaded(true);
      },
    );
    return () => controller.abort();
  }, [job.id]);

  // Poll every 3 s only while a run for this job is active; refresh the job once when it ends.
  useEffect(() => {
    if (!active) {
      if (wasActive.current) {
        wasActive.current = false;
        void refresh();
        onRunsEnded();
      }
      return;
    }
    wasActive.current = true;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      api.runs(controller.signal, job.id).then(
        result => {
          if (!controller.signal.aborted) setRuns(sorted(result.data.runs));
        },
        () => undefined,
      );
    }, 3000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [active, job.id]);

  const visible = (() => {
    const activeRuns = runs.filter(isActiveRun);
    if (activeRuns.length) return activeRuns;
    const latest = runs[0];
    if (!latest) return [];
    return runs.filter(
      run => run === latest || (latest.groupId !== null && run.groupId === latest.groupId),
    );
  })();
  const dialogAction = actionButtons.find(item => item.key === dialog) ?? null;
  const publishReason = !live.publish.enabled
    ? (live.publish.reason ?? 'Not available right now.')
    : letterDirty
      ? 'Save first.'
      : letterHash === null
        ? letterNote
        : null;
  const startedRuns = (started: RunRecord[]) => {
    setDialog(null);
    setRuns(previous =>
      sorted([...started, ...previous.filter(run => !started.some(item => item.id === run.id))]),
    );
    void refresh();
  };
  const refreshActive = async (id: string | null) => {
    setDialog(null);
    setNotice('A run for this job is already active. It is shown below.');
    try {
      const result = await api.runs(new AbortController().signal, job.id);
      setRuns(sorted(result.data.runs));
    } catch {
      if (id) setNotice(`A run for this job is already active (run ${id}).`);
    }
    void refresh();
  };

  // F34: the primary button starts the run with the saved per-function settings. The request omits
  // the selection, so the server resolves them and runs its own pre-flight; any refusal is shown
  // here, not in a dialog.
  const startDirect = async (key: JobActionKey, from: 'panel' | 'inline' | 'header' = 'panel') => {
    const fromInline = from === 'inline';
    setNotice(null);
    onInlineIssue(null);
    setDirectBusy(key);
    const fail = (message: string) => {
      setNotice(message);
      if (fromInline) onInlineIssue(message);
      if (from === 'header') onHeaderIssue(message);
    };
    try {
      const result = await api.startJobRun(
        jobRunBody(key, job.id),
        nonce,
        new AbortController().signal,
      );
      startedRuns(result.data.runs);
      if (fromInline) onInlineStarted();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'PREREQUISITE_FAILED') {
        const next =
          isObject(failure.current) && isObject(failure.current.actions)
            ? (failure.current.actions as unknown as JobActions)
            : null;
        if (next) setOverride(next);
        fail(`That action is no longer available: ${next?.[key]?.reason ?? failure.message}`);
      } else if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') {
        await refreshActive(
          isObject(failure.current) && typeof failure.current.activeRunId === 'string'
            ? failure.current.activeRunId
            : null,
        );
        if (fromInline) onInlineStarted();
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        fail(
          'The local session is no longer valid, so nothing was started. Reload the page and try again.',
        );
      } else {
        fail(failure instanceof ApiFailure ? failure.message : 'The run could not be started.');
      }
    } finally {
      setDirectBusy(null);
    }
  };

  return (
    <section className="edit-card action-bar" aria-labelledby="actions-title">
      <h3 id="actions-title">Actions</h3>
      <p className="pane-meta">
        Each action starts a background run on your subscription command line tool with your saved
        provider and model. Choose "with model" to pick others for one run. Runs and logs appear
        below.
      </p>
      <div className="action-buttons">
        {actionButtons.map(item => {
          const state = live[item.key];
          const reasonId = `action-reason-${item.key}`;
          return (
            <div className="action-item" key={item.key}>
              <div className="action-pair">
                <button
                  className="quiet-button"
                  disabled={!state.enabled || directBusy !== null}
                  aria-describedby={state.enabled ? undefined : reasonId}
                  onClick={() => void startDirect(item.key)}
                >
                  {directBusy === item.key
                    ? 'Starting…'
                    : item.key === 'evaluate' && hasReport
                      ? 'Re-evaluate'
                      : item.label}
                </button>
                <button
                  className="quiet-button action-with-model"
                  disabled={!state.enabled || directBusy !== null}
                  aria-describedby={state.enabled ? undefined : reasonId}
                  aria-label={`${item.key === 'evaluate' && hasReport ? 'Re-evaluate' : item.label} with model`}
                  onClick={() => {
                    setNotice(null);
                    setDialog(item.key);
                  }}
                >
                  with model
                </button>
              </div>
              {!state.enabled && (
                <p className="action-reason" id={reasonId}>
                  {state.reason ?? 'Not available right now.'}
                </p>
              )}
            </div>
          );
        })}
        <div className="action-item" key="publish">
          <button
            className="quiet-button"
            disabled={publishReason !== null}
            aria-describedby={publishReason === null ? undefined : 'action-reason-publish'}
            onClick={() => {
              setNotice(null);
              setDialog('publish');
            }}
          >
            Publish PDF
          </button>
          {publishReason !== null && (
            <p className="action-reason" id="action-reason-publish">
              {publishReason}
            </p>
          )}
        </div>
      </div>
      {notice && (
        <div className="notice notice-warn" role="alert">
          <p>{notice}</p>
        </div>
      )}
      {runsHost &&
        createPortal(
          <>
            {readError && (
              <p className="missing-copy">The runs for this job could not be read: {readError}</p>
            )}
            {loaded && !readError && visible.length === 0 && (
              <p className="missing-copy">No runs have been started for this job.</p>
            )}
            {visible.length > 0 && (
              <ul className="run-cards" aria-label="Runs for this job" aria-live="polite">
                {visible.map(run => (
                  <RunCard key={run.id} run={run} />
                ))}
              </ul>
            )}
          </>,
          runsHost,
        )}
      {dialogAction &&
        createPortal(
          <ActionDialog
            action={dialogAction}
            job={job}
            nonce={nonce}
            onClose={() => setDialog(null)}
            onStarted={started => {
              setDialog(null);
              setRuns(previous =>
                sorted([
                  ...started,
                  ...previous.filter(run => !started.some(item => item.id === run.id)),
                ]),
              );
              void refresh();
            }}
            onPrerequisite={(next, reason) => {
              setDialog(null);
              if (next) setOverride(next);
              setNotice(`That action is no longer available: ${reason}`);
            }}
            onActive={async id => {
              setDialog(null);
              setNotice('A run for this job is already active. It is shown below.');
              try {
                const result = await api.runs(new AbortController().signal, job.id);
                setRuns(sorted(result.data.runs));
              } catch {
                if (id) setNotice(`A run for this job is already active (run ${id}).`);
              }
              void refresh();
            }}
          />,
          document.body,
        )}
      {dialog === 'publish' &&
        letterHash !== null &&
        createPortal(
          <PublishDialog
            job={job}
            hash={letterHash}
            hasPdf={letterHasPdf}
            nonce={nonce}
            onClose={() => setDialog(null)}
            onStarted={startedRuns}
            onPrerequisite={(next, reason) => {
              setDialog(null);
              if (next) setOverride(next);
              setNotice(`That action is no longer available: ${reason}`);
            }}
            onActive={refreshActive}
            onConflict={current => {
              setDialog(null);
              onLetterConflict(current);
              setNotice(
                'The cover letter changed since it was loaded, so nothing was published. The current saved text is loaded. Review it and publish again; any unsaved edits are kept.',
              );
            }}
          />,
          document.body,
        )}
    </section>
  );
}

// ---- Package 4.3 F11 (D067): full-page workspace. The report and the job description share the page
// with a draggable divider; the tools live in slide-out panels opened from a rail at the right edge.
type WorkspacePanel = 'actions' | 'status' | 'history' | 'letter';
const SPLIT_KEY = 'career-ops-ws-split';
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;

function readSplit() {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(value) && value >= SPLIT_MIN && value <= SPLIT_MAX)
      return Math.round(value);
  } catch {
    /* A remembered ratio is only a convenience. */
  }
  return 50;
}

// The share of the width the report takes. Pointer drag and the arrow keys on the separator change
// it; the value is remembered in localStorage when a change ends.
function useSplitRatio() {
  const [ratio, setRatio] = useState(readSplit);
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const latest = useRef(ratio);
  const clamp = (value: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
  const apply = (value: number) => {
    const next = clamp(value);
    latest.current = next;
    setRatio(next);
  };
  const persist = () => {
    try {
      localStorage.setItem(SPLIT_KEY, String(latest.current));
    } catch {
      /* Cosmetic preference only. */
    }
  };
  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const box = ref.current?.getBoundingClientRect();
      if (!dragging.current || !box || box.width === 0) return;
      apply(((event.clientX - box.left) / box.width) * 100);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      persist();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 10 : 2;
      if (event.key === 'ArrowLeft') apply(latest.current - step);
      else if (event.key === 'ArrowRight') apply(latest.current + step);
      else if (event.key === 'Home') apply(SPLIT_MIN);
      else if (event.key === 'End') apply(SPLIT_MAX);
      else return;
      event.preventDefault();
      persist();
    },
  };
  return { ratio, ref, handlers, min: SPLIT_MIN, max: SPLIT_MAX };
}

// A slide-out panel. It stays mounted while closed (hidden), so unsaved edits, drafts and run state
// inside it survive closing and reopening. While open it takes focus, keeps Tab inside, and closes on
// Escape unless a modal dialog started from inside it is on top.
function SlidePanel({
  id,
  title,
  open,
  onClose,
  children,
  solo = false,
}: {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** No tool rail beside it (the Jobs page), so it reaches the right edge. */
  solo?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // F25: the slide-out starts at the bottom edge of the top bar (which scrolls with the page below
  // 1024 px) and ends at the bottom of the viewport, so the bar stays usable.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bar = document.querySelector<HTMLElement>('.ws-bar, .topbar');
      const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
      if (ref.current) ref.current.style.top = `${top}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (open && !wasOpen.current)
      ref.current?.querySelector<HTMLElement>('.ws-panel-close')?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <section
      ref={ref}
      id={id}
      className={solo ? 'ws-panel ws-panel-solo' : 'ws-panel'}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      hidden={!open}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          if (document.querySelector('dialog[open]')) return;
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(element => element.offsetParent !== null);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="ws-panel-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="quiet-button ws-panel-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="ws-panel-body">{children}</div>
    </section>
  );
}

function WorkspacePage({
  id,
  writer,
  dispatch,
  onHeading,
  chrome,
}: {
  id: string;
  writer: { nonce: string } | null;
  dispatch: { nonce: string } | null;
  onHeading: (heading: { title: string; lead: string } | null) => void;
  /** Connection status, Connection details and the theme button, shown at the end of the top bar. */
  chrome: ReactNode;
}) {
  const [state, setState] = useState<EndpointState<JobDetailResponse>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [pane, setPane] = useState<'jd' | 'evaluation'>('jd');
  const [runsHost, setRunsHost] = useState<HTMLElement | null>(null);
  const [openPanel, setOpenPanel] = useState<WorkspacePanel | null>(null);
  // F26: a primary-button press anywhere outside the open slide-out closes it. The panel, the rail
  // (its buttons toggle themselves), the divider and any dialog opened from the panel are inside.
  useEffect(() => {
    if (!openPanel) return;
    const key = openPanel;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('.ws-panel, .ws-rail, .ws-divider, dialog')) return;
      // Focus goes back to the rail button unless the press landed on something interactive.
      const interactive = event.target.closest(
        'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), dialog',
      );
      setOpenPanel(null);
      if (!interactive) window.requestAnimationFrame(() => railButtons.current[key]?.focus());
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [openPanel]);
  const [evaluateRequest, setEvaluateRequest] = useState(0);
  const [evaluateDialogRequest, setEvaluateDialogRequest] = useState(0);
  const [evaluateIssue, setEvaluateIssue] = useState<string | null>(null);
  const [headerRequest, setHeaderRequest] = useState<{
    key: 'cv' | 'letter' | 'publish';
    n: number;
  }>({ key: 'cv', n: 0 });
  const [headerIssue, setHeaderIssue] = useState<string | null>(null);
  const [letterOpen, setLetterOpen] = useState(false);
  const [activeActions, setActiveActions] = useState<string[]>([]);
  const [pendingHeader, setPendingHeader] = useState<string | null>(null);
  useEffect(() => {
    if (pendingHeader === null) return;
    const timer = window.setTimeout(() => setPendingHeader(null), 4000);
    return () => window.clearTimeout(timer);
  }, [pendingHeader]);
  useEffect(() => {
    if (pendingHeader !== null && activeActions.includes(pendingHeader)) setPendingHeader(null);
  }, [activeActions, pendingHeader]);
  const askHeader = (key: 'cv' | 'letter' | 'publish') => {
    setHeaderIssue(null);
    if (key !== 'publish') setPendingHeader(key);
    setHeaderRequest(previous => ({ key, n: previous.n + 1 }));
  };
  const railButtons = useRef<Partial<Record<WorkspacePanel, HTMLButtonElement | null>>>({});
  const split = useSplitRatio();
  const [cacheSync, setCacheSync] = useState<'ok' | 'error'>('ok');
  const refresh = async (): Promise<DetailData | null> => {
    try {
      const fresh = await api.jobDetail(id, new AbortController().signal);
      setState({ kind: 'success', value: fresh });
      return fresh.data;
    } catch {
      return null;
    }
  };
  const applyJob = (job: DetailJob) =>
    setState(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: { ...previous.value, data: { ...previous.value.data, job } },
          }
        : previous,
    );
  const applyJd = (job: DetailJob, jd: JobDetailJd) =>
    setState(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: { ...previous.value, data: { ...previous.value.data, job, jd } },
          }
        : previous,
    );
  const ctx: EditContext | null = writer
    ? { id, nonce: writer.nonce, refresh, applyJob, applyJd }
    : null;
  // The saved cover letter is read only when something here can use it (the editor or Publish PDF).
  const detailNow = state.kind === 'success' ? state.value.data : null;
  const letterItem =
    detailNow && !detailNow.materials.ambiguous && detailNow.materials.match !== 'none'
      ? detailNow.materials.items.find(
          item => item.key === 'letter' && item.name === 'cover-letter.md',
        )
      : undefined;
  const letter = useLetter(
    id,
    Boolean(letterItem) && Boolean(writer || dispatch),
    letterItem?.modifiedAt ?? '',
  );
  const [letterDirty, setLetterDirty] = useState(false);
  // The page heading names the job: company and role as the title, the job number as the lead.
  const headingJob = state.kind === 'success' ? state.value.data.job : null;
  useEffect(() => {
    onHeading(
      headingJob
        ? {
            title: [
              headingJob.company || 'Company missing',
              headingJob.role || 'Role missing',
            ].join(' · '),
            lead: `Job #${headingJob.id}`,
          }
        : null,
    );
    return () => onHeading(null);
  }, [headingJob?.company, headingJob?.role, headingJob?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void api.jobDetail(id, controller.signal).then(
      value => {
        if (!controller.signal.aborted) setState({ kind: 'success', value });
      },
      error => {
        if (!controller.signal.aborted)
          setState({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => controller.abort();
  }, [id, retry]);

  const backLink = (
    <a className="back-link" href={`${location.search}#/jobs`}>
      ← Back to jobs
    </a>
  );
  const back = (
    <header className="ws-bar ws-bar-bare">
      {backLink}
      <h1>Job workspace</h1>
      <div className="ws-chrome">{chrome}</div>
    </header>
  );
  if (state.kind === 'loading')
    return (
      <div className="ws-plain">
        {back}
        <section className="empty-state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading job…
        </section>
      </div>
    );
  if (state.kind === 'error') {
    const { error } = state;
    if (error.code === 'INVALID_REQUEST' && error.fields?.id)
      return (
        <div className="ws-plain">
          {back}
          <section className="empty-state" role="status">
            <h3>This job address is not valid</h3>
            <p>Job IDs are whole numbers, for example #/jobs/12.</p>
          </section>
        </div>
      );
    if (error.code === 'NOT_FOUND')
      return (
        <div className="ws-plain">
          {back}
          <section className="empty-state" role="status">
            <h3>Job not found</h3>
            <p>No job with ID {id} exists in the database.</p>
          </section>
        </div>
      );
    const unavailable = error.code === 'DATABASE_UNAVAILABLE' || error.code === 'SCHEMA_NOT_READY';
    return (
      <div className="ws-plain">
        {back}
        <div className={`notice ${unavailable ? 'notice-warn' : 'notice-error'}`} role="alert">
          <div>
            <strong>
              {unavailable ? 'The database is unavailable.' : 'The job could not be loaded.'}
            </strong>
            <p>{error.message}</p>
          </div>
          <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { job, jd, evaluation, history, materials, interviewPrep } = state.value.data;
  const salary = formatSalary(job.salary);
  const letterItemKnown = !materials.ambiguous && materials.items.some(m => m.key === 'letter');
  const reportText = evaluation.report.text;
  const jdPane = (
    <section
      className="doc-pane"
      id="pane-jd"
      role="tabpanel"
      aria-labelledby="tab-jd"
      data-active={pane === 'jd'}
    >
      <h3>Job description</h3>
      {cacheSync === 'error' && (
        <div className="notice notice-warn" role="alert">
          <p>
            Saved to the database, but the cache file under data/jds was not updated. The stored
            description is correct; the cache copy is out of date.
          </p>
        </div>
      )}
      {ctx ? (
        <JdPaneEditable jd={jd} ctx={ctx} onCacheSync={setCacheSync} />
      ) : jd ? (
        <>
          <p className="pane-meta">Stored {formatDateTime(jd.syncedAt)}</p>
          <pre className="doc-text" tabIndex={0} aria-label="Job description text">
            {jd.text || 'The stored job description is empty.'}
          </pre>
        </>
      ) : (
        <p className="missing-copy">No job description is stored for this job.</p>
      )}
    </section>
  );
  const evaluationPane = (
    <section
      className="doc-pane"
      id="pane-evaluation"
      role="tabpanel"
      aria-labelledby="tab-evaluation"
      data-active={pane === 'evaluation'}
    >
      <h3>Evaluation report</h3>
      {job.evaluationError && (
        <p className="missing-copy">The last evaluation run for this job recorded an error.</p>
      )}
      {evaluation.report.state === 'ok' && reportText !== null ? (
        reportText ? (
          <ReportMarkdown text={reportText} />
        ) : (
          <p className="missing-copy">The evaluation report is empty.</p>
        )
      ) : evaluation.report.state === 'missing' && dispatch ? (
        <div className="report-empty">
          <p className="missing-copy">{reportMessages.missing}</p>
          {evaluateIssue && (
            <p className="field-error" role="alert">
              {evaluateIssue}
            </p>
          )}
          {state.value.data.actions.evaluate.enabled ? (
            <div className="action-pair">
              <button
                className="primary-button"
                onClick={() => {
                  setEvaluateRequest(value => value + 1);
                }}
              >
                Evaluate this job
              </button>
              <button
                className="quiet-button action-with-model"
                aria-label="Evaluate this job with model"
                onClick={() => setEvaluateDialogRequest(value => value + 1)}
              >
                with model
              </button>
            </div>
          ) : (
            <p className="action-reason">
              {state.value.data.actions.evaluate.reason ?? 'Evaluate is not available right now.'}
            </p>
          )}
        </div>
      ) : (
        <p className="missing-copy">
          {reportMessages[evaluation.report.state === 'ok' ? 'invalid' : evaluation.report.state]}
        </p>
      )}
    </section>
  );
  const moveTab = (event: KeyboardEvent, current: 'jd' | 'evaluation') => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = current === 'jd' ? 'evaluation' : 'jd';
    setPane(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const toggle = (key: WorkspacePanel) => {
    if (openPanel === key) {
      setOpenPanel(null);
      return;
    }
    setOpenPanel(key);
  };
  const closePanel = (key: WorkspacePanel) => {
    railButtons.current[key]?.focus();
    setOpenPanel(null);
  };
  const railItems: { key: WorkspacePanel; label: string; icon: string; show: boolean }[] = [
    { key: 'actions', label: 'Actions', icon: '▶', show: dispatch !== null },
    { key: 'status', label: ctx ? 'Status' : 'Notes', icon: '✎', show: true },
    { key: 'history', label: 'History', icon: '↺', show: true },
    { key: 'letter', label: 'Letter', icon: '✉', show: true },
  ];
  const panel = (key: WorkspacePanel, title: string, children: ReactNode) => (
    <SlidePanel
      key={key}
      id={`ws-panel-${key}`}
      title={title}
      open={openPanel === key}
      onClose={() => closePanel(key)}
    >
      {children}
    </SlidePanel>
  );

  return (
    <article className="workspace ws">
      <header className="ws-bar">
        <div className="ws-bar-main">
          {backLink}
          <h1>{[job.company || 'Company missing', job.role || 'Role missing'].join(' · ')}</h1>
          <div className="ws-chrome">{chrome}</div>
        </div>
        <div className="ws-meta">
          <dl className="ws-facts">
            <div>
              <dt>ID</dt>
              <dd>{job.id}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="ws-status">
                <span className={`job-status status-${job.status.toLowerCase()}`}>
                  {job.status}
                </span>
                {ctx && (
                  <QuickMoves
                    job={job}
                    nonce={ctx.nonce}
                    onMoved={moved => {
                      ctx.applyJob(moved);
                      void ctx.refresh();
                    }}
                    onConflict={ctx.refresh}
                    evaluate={
                      dispatch
                        ? {
                            disabledReason: state.value.data.actions.evaluate.enabled
                              ? null
                              : (state.value.data.actions.evaluate.reason ??
                                'Evaluate is not available right now.'),
                            start: () => {
                              setEvaluateIssue(null);
                              setEvaluateRequest(value => value + 1);
                            },
                          }
                        : null
                    }
                  />
                )}
              </dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{scoreText(job.score, job.status === 'Pending')}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDate(job.addedDate)}</dd>
            </div>
            <div>
              <dt>Status date</dt>
              <dd>{formatDate(job.statusDate)}</dd>
            </div>
            <div>
              <dt>Compensation</dt>
              <dd>
                {compensationText(job)}
                {salary && <small>Manual range: {salary}</small>}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {job.url ? (
                  <a href={job.url} target="_blank" rel="noopener noreferrer">
                    Open posting (new tab)
                  </a>
                ) : (
                  'No source link'
                )}
              </dd>
            </div>
          </dl>
          <div className="ws-materials" aria-label="Materials">
            {(['cv', 'letter'] as const).map(key => {
              const item = materials.ambiguous
                ? undefined
                : materials.items.find(m => m.key === key);
              return (
                <div key={key}>
                  <span>{materialLabels[key]}</span>
                  {item && key === 'letter' && letter.state.kind === 'ok' ? (
                    <button
                      type="button"
                      className="ws-material-link"
                      aria-haspopup="dialog"
                      onClick={() => setLetterOpen(true)}
                    >
                      {item.name}
                    </button>
                  ) : item ? (
                    <a
                      href={materialHref(job.id, key, item.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.name}
                    </a>
                  ) : dispatch && !materials.ambiguous ? (
                    <button
                      type="button"
                      className="quiet-button ws-material-button"
                      disabled={
                        pendingHeader === key ||
                        activeActions.includes(key) ||
                        !state.value.data.actions[key].enabled
                      }
                      title={
                        state.value.data.actions[key].enabled
                          ? undefined
                          : (state.value.data.actions[key].reason ?? 'Not available right now.')
                      }
                      onClick={() => askHeader(key)}
                    >
                      {pendingHeader === key || activeActions.includes(key)
                        ? 'Drafting…'
                        : key === 'cv'
                          ? 'Draft CV'
                          : 'Draft cover letter'}
                    </button>
                  ) : (
                    <em>{materials.ambiguous ? 'unclear which folder' : 'none yet'}</em>
                  )}
                </div>
              );
            })}
            <div>
              <span>Letter PDF</span>
              {letter.state.kind === 'ok' && letter.state.data.pdf !== null ? (
                <a
                  href={letterPdfHref(job.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open letter PDF (new tab)"
                >
                  Open PDF
                </a>
              ) : dispatch &&
                letter.state.kind === 'ok' &&
                letter.state.data.pdf === null &&
                letterItemKnown ? (
                <button
                  type="button"
                  className="quiet-button ws-material-button"
                  disabled={pendingHeader === 'publish' || activeActions.includes('publish')}
                  onClick={() => askHeader('publish')}
                >
                  {pendingHeader === 'publish' || activeActions.includes('publish')
                    ? 'Publishing…'
                    : 'Publish PDF'}
                </button>
              ) : letter.state.kind === 'loading' ? (
                <em>checking…</em>
              ) : letter.state.kind === 'error' ? (
                <em>could not be read</em>
              ) : letterItemKnown && letter.state.kind === 'idle' ? (
                <em>not checked here</em>
              ) : (
                <em>none yet</em>
              )}
            </div>
          </div>
          {headerIssue && (
            <p className="field-error" role="alert">
              {headerIssue}
            </p>
          )}
          {dispatch &&
            !materials.ambiguous &&
            (['cv', 'letter'] as const)
              .filter(
                key =>
                  !materials.items.some(m => m.key === key) &&
                  !state.value.data.actions[key].enabled,
              )
              .map(key => (
                <p className="pane-meta ws-material-reason" key={key}>
                  {key === 'cv' ? 'Draft CV' : 'Draft cover letter'} is not available:{' '}
                  {state.value.data.actions[key].reason ?? 'not available right now.'}
                </p>
              ))}
        </div>
      </header>
      {letterOpen &&
        letter.state.kind === 'ok' &&
        createPortal(
          <LetterModal
            jobId={job.id}
            letter={letter.state.data}
            writer={writer}
            fileHref={materialHref(
              job.id,
              'letter',
              materials.items.find(m => m.key === 'letter')?.name,
            )}
            fileName={materials.items.find(m => m.key === 'letter')?.name ?? 'cover-letter.md'}
            canPublish={Boolean(dispatch)}
            publishNote={
              !state.value.data.actions.publish.enabled
                ? (state.value.data.actions.publish.reason ?? 'Not available right now.')
                : letterDirty
                  ? 'Save first.'
                  : null
            }
            onPublish={() => askHeader('publish')}
            onApply={letter.apply}
            onDirty={setLetterDirty}
            onReload={letter.reload}
            onClose={() => setLetterOpen(false)}
          />,
          document.body,
        )}

      <div className="ws-body">
        <div className="ws-center">
          <div className="pane-tabs" role="tablist" aria-label="Job text">
            {(['jd', 'evaluation'] as const).map(key => (
              <button
                key={key}
                id={`tab-${key}`}
                role="tab"
                aria-selected={pane === key}
                aria-controls={`pane-${key}`}
                tabIndex={pane === key ? 0 : -1}
                className="quiet-button"
                onClick={() => setPane(key)}
                onKeyDown={event => moveTab(event, key)}
              >
                {key === 'jd' ? 'Job description' : 'Evaluation'}
              </button>
            ))}
          </div>
          <div
            className="ws-split"
            ref={split.ref}
            style={{ '--ws-left': `${split.ratio}%` } as CSSProperties}
          >
            {evaluationPane}
            <div
              className="ws-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the evaluation report and the job description"
              aria-valuemin={split.min}
              aria-valuemax={split.max}
              aria-valuenow={split.ratio}
              aria-valuetext={`Report ${split.ratio} percent, job description ${100 - split.ratio} percent`}
              tabIndex={0}
              {...split.handlers}
            />
            {jdPane}
          </div>
        </div>
        <nav className="ws-rail" aria-label="Job tools">
          {railItems
            .filter(item => item.show)
            .map(item => (
              <button
                key={item.key}
                type="button"
                ref={element => {
                  railButtons.current[item.key] = element;
                }}
                className="ws-rail-button"
                aria-expanded={openPanel === item.key}
                aria-controls={`ws-panel-${item.key}`}
                onClick={() => toggle(item.key)}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
        </nav>
      </div>

      {dispatch &&
        panel(
          'actions',
          'Actions',
          <>
            {dispatch && (
              <JobActionsPanel
                job={job}
                actions={state.value.data.actions}
                nonce={dispatch.nonce}
                refresh={refresh}
                letterHash={
                  letter.state.kind === 'ok' && letter.state.data.editable
                    ? letter.state.data.contentHash
                    : null
                }
                letterHasPdf={letter.state.kind === 'ok' && letter.state.data.pdf !== null}
                letterNote={
                  letter.state.kind === 'loading'
                    ? 'Reading the cover letter…'
                    : letter.state.kind === 'error'
                      ? 'The cover letter could not be read.'
                      : letter.state.kind === 'ok'
                        ? 'This cover letter cannot be published from here.'
                        : 'No cover letter to publish.'
                }
                letterDirty={letterDirty}
                runsHost={runsHost}
                evaluateRequest={evaluateRequest}
                evaluateDialogRequest={evaluateDialogRequest}
                hasReport={evaluation.report.state === 'ok'}
                onInlineIssue={setEvaluateIssue}
                onInlineStarted={() => setOpenPanel('actions')}
                headerRequest={headerRequest}
                onHeaderIssue={message => {
                  setHeaderIssue(message);
                  if (message) setPendingHeader(null);
                }}
                onActiveActions={setActiveActions}
                onLetterConflict={current => {
                  if (letter.state.kind === 'ok' && current)
                    letter.apply({ ...letter.state.data, ...current });
                  else letter.reload();
                }}
                onRunsEnded={letter.reload}
              />
            )}

            <section className="ws-section" aria-labelledby="runs-title">
              <h3 id="runs-title">Runs and logs</h3>
              <div ref={setRunsHost} />
            </section>
          </>,
        )}
      {ctx &&
        panel(
          'status',
          'Status and details',
          <>
            <div className="edit-actions">
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  setOpenPanel(null);
                  setPane('jd');
                  window.setTimeout(() => {
                    const target =
                      document.querySelector<HTMLElement>('#pane-jd [data-jd-edit]') ??
                      document.querySelector<HTMLElement>('#pane-jd textarea');
                    target?.focus();
                  }, 0);
                }}
              >
                Go to the job description editor
              </button>
            </div>
            {ctx && (
              <div className="edit-grid-outer">
                <StatusControl job={job} ctx={ctx} />
                <DetailsEditor job={job} ctx={ctx} />
              </div>
            )}

            <section className="workspace-section" aria-labelledby="notes-title">
              <h3 id="notes-title">Notes</h3>
              {job.notes ? (
                <pre className="doc-text notes-text">{job.notes}</pre>
              ) : (
                <p className="missing-copy">No notes are recorded for this job.</p>
              )}
            </section>

            {job.status === 'Discarded' && (
              <section className="workspace-section" aria-labelledby="discard-title">
                <h3 id="discard-title">Discard reason</h3>
                <p className={job.discardReason ? '' : 'missing-copy'}>
                  {job.discardReason || 'No reason was recorded.'}
                </p>
              </section>
            )}
          </>,
        )}
      {!ctx &&
        panel(
          'status',
          'Notes',
          <>
            {' '}
            <section className="workspace-section" aria-labelledby="notes-title">
              <h3 id="notes-title">Notes</h3>
              {job.notes ? (
                <pre className="doc-text notes-text">{job.notes}</pre>
              ) : (
                <p className="missing-copy">No notes are recorded for this job.</p>
              )}
            </section>
            {job.status === 'Discarded' && (
              <section className="workspace-section" aria-labelledby="discard-title">
                <h3 id="discard-title">Discard reason</h3>
                <p className={job.discardReason ? '' : 'missing-copy'}>
                  {job.discardReason || 'No reason was recorded.'}
                </p>
              </section>
            )}
          </>,
        )}
      {panel(
        'history',
        'History',
        <>
          <section className="workspace-section" aria-labelledby="history-title">
            <h3 id="history-title">Status history</h3>
            <p className="pane-meta">
              Every status change for this job, newest first, and what made it.
            </p>
            {history.length === 0 ? (
              <p className="missing-copy">No status events are recorded for this job.</p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Status history" tabIndex={0}>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Change</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(event => (
                      <tr key={event.id}>
                        <td>{formatDateTime(event.occurredAt)}</td>
                        <td>
                          {event.oldStatus
                            ? `${event.oldStatus} → ${event.newStatus}`
                            : `Created as ${event.newStatus}`}
                        </td>
                        <td>{event.reason || '—'}</td>
                        <td>{actorLabel(event.actor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="workspace-section" aria-labelledby="eval-history-title">
            <h3 id="eval-history-title">Evaluation history</h3>
            {evaluation.history.length === 0 ? (
              <p className="missing-copy">No evaluation runs are recorded for this job.</p>
            ) : (
              <div
                className="table-scroll"
                role="region"
                aria-label="Evaluation history"
                tabIndex={0}
              >
                <table className="history-table">
                  <thead>
                    <tr>
                      <th scope="col">Run</th>
                      <th scope="col">When</th>
                      <th scope="col">Score</th>
                      <th scope="col">Result status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluation.history.map(run => (
                      <tr key={run.id}>
                        <td>{run.id}</td>
                        <td>{formatDateTime(run.createdAt)}</td>
                        <td>{scoreText(run.score)}</td>
                        <td>{run.resultStatus || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>,
      )}
      {panel(
        'letter',
        'Letter and materials',
        <>
          <section className="workspace-section" aria-labelledby="materials-title">
            <h3 id="materials-title">Materials</h3>
            {materials.ambiguous ? (
              <p className="missing-copy">
                More than one output folder matches this job, so no materials are shown.
              </p>
            ) : materials.items.length === 0 ? (
              <p className="missing-copy">No CV, cover letter or brief was found for this job.</p>
            ) : (
              <>
                {materials.match === 'legacy' && (
                  <p className="pane-meta">Matched by company and role, not by job ID.</p>
                )}
                <ul className="file-list">
                  {materials.items.map(item => (
                    <li key={item.key}>
                      <div>
                        <strong>{materialLabels[item.key]}</strong>
                        <span>
                          {item.name} · {item.kind.toUpperCase()} · {formatSize(item.size)} ·
                          Modified {formatDateTime(item.modifiedAt)}
                        </span>
                      </div>
                      <a
                        href={materialHref(job.id, item.key, item.name)}
                        title={item.name}
                        target={item.kind === 'pdf' ? '_blank' : undefined}
                        rel={item.kind === 'pdf' ? 'noopener noreferrer' : undefined}
                        aria-label={`Open ${materialLabels[item.key]}${item.kind === 'pdf' ? ' (new tab)' : ' as text'}`}
                      >
                        Open
                      </a>
                    </li>
                  ))}
                </ul>
                <LetterSection
                  jobId={job.id}
                  letter={letter.state}
                  writer={writer}
                  onApply={letter.apply}
                  onDirty={setLetterDirty}
                  onReload={letter.reload}
                />
              </>
            )}
          </section>

          {job.status === 'Interview' && (
            <section className="workspace-section" aria-labelledby="prep-title">
              <h3 id="prep-title">Interview prep</h3>
              {interviewPrep ? (
                <ul className="file-list">
                  <li>
                    <div>
                      <strong>{materialLabels.prep}</strong>
                      <span>
                        {interviewPrep.name} · {formatSize(interviewPrep.size)}
                      </span>
                    </div>
                    <a
                      href={materialHref(job.id, 'prep', interviewPrep.name)}
                      aria-label="Open Interview prep as text"
                    >
                      Open
                    </a>
                  </li>
                </ul>
              ) : (
                <p className="missing-copy">No interview prep file was found for this job.</p>
              )}
            </section>
          )}
        </>,
      )}
    </article>
  );
}

function OverviewPage({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<EndpointState<OverviewResponse>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // A refresh after a finished run keeps the numbers on screen until the new ones arrive.
    setState(previous => (previous.kind === 'success' ? previous : { kind: 'loading' }));
    void api.overview(controller.signal).then(
      value => {
        if (!controller.signal.aborted) setState({ kind: 'success', value });
      },
      error => {
        if (!controller.signal.aborted)
          setState({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => controller.abort();
  }, [retry, refreshKey]);
  if (state.kind === 'loading')
    return (
      <section className="empty-state" role="status">
        <span className="spinner" aria-hidden="true" /> Loading overview…
      </section>
    );
  if (state.kind === 'error')
    return (
      <div className="notice notice-error" role="alert">
        <div>
          <strong>Overview could not be loaded.</strong>
          <p>{state.error.message}</p>
        </div>
        <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
          Retry overview
        </button>
      </div>
    );
  const { metrics, progress } = state.value.data;
  return (
    <div className="overview-content">
      <p className="inferred-label">
        Pipeline metrics inferred from current job statuses and notes
      </p>
      <section className="metric-grid" aria-label="Pipeline metrics">
        <article className="metric-card">
          <span>Jobs in pipeline</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="metric-card">
          <span>Actionable</span>
          <strong>{metrics.actionable}</strong>
        </article>
        <article className="metric-card">
          <span>Average score</span>
          <strong>{metrics.avgScore === null ? '—' : metrics.avgScore.toFixed(2)}</strong>
        </article>
        <article className="metric-card">
          <span>Top score</span>
          <strong>{metrics.topScore === null ? '—' : metrics.topScore.toFixed(1)}</strong>
        </article>
      </section>
      <section className="overview-grid">
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Pipeline</h2>
              <p>Current status counts and progress</p>
            </div>
          </div>
          <div className="status-counts">
            {Object.entries(metrics.byStatus).map(([status, count]) => (
              <div key={status}>
                <span>{status}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Progress funnel</h2>
              <p>Rates use the existing pipeline formulas</p>
            </div>
          </div>
          <div className="funnel-list">
            {progress.funnel.map(step => (
              <div className="funnel-row" key={step.label}>
                <div>
                  <strong>{step.label}</strong>
                  <span>
                    {step.count} · {formatPercent(step.percent)}
                  </span>
                </div>
                <progress
                  max="100"
                  value={step.percent}
                  aria-label={`${step.label}: ${step.count}, ${formatPercent(step.percent)}`}
                />
              </div>
            ))}
          </div>
          <div className="rate-row">
            <span>
              Response rate <strong>{formatPercent(progress.responseRate)}</strong>
            </span>
            <span>
              Interview rate <strong>{formatPercent(progress.interviewRate)}</strong>
            </span>
            <span>
              Offer rate <strong>{formatPercent(progress.offerRate)}</strong>
            </span>
          </div>
        </article>
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Score distribution</h2>
              <p>Includes any retained score</p>
            </div>
          </div>
          <div className="bucket-list">
            {progress.scoreBuckets.map(bucket => {
              const key = bucket.label.trim();
              const range = bucketFilters[key];
              const content = (
                <>
                  <span>{key}</span>
                  <strong>{bucket.count}</strong>
                </>
              );
              if (!range) return <div key={bucket.label}>{content}</div>;
              const params: Record<string, string> = {};
              if (range.scoreMin !== undefined) params.scoreMin = String(range.scoreMin);
              if (range.scoreMax !== undefined) params.scoreMax = String(range.scoreMax);
              return (
                <a
                  key={bucket.label}
                  className="overview-link"
                  href={listHref(params)}
                  aria-label={`Show ${bucket.count} jobs with score ${key}`}
                >
                  {content}
                </a>
              );
            })}
          </div>
        </article>
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Added by week</h2>
              <p>Last eight available ISO weeks</p>
            </div>
          </div>
          {progress.weeklyActivity.length ? (
            <div className="weekly-list">
              {progress.weeklyActivity.map(week => (
                <a
                  key={week.week}
                  className="overview-link"
                  href={listHref({ addedWeek: week.week })}
                  aria-label={`Show ${week.count} jobs added in ${week.week}`}
                >
                  <span>{week.week}</span>
                  <strong>{week.count}</strong>
                </a>
              ))}
            </div>
          ) : (
            <p className="subtle-copy">No dated jobs are available for weekly activity.</p>
          )}
        </article>
      </section>
    </div>
  );
}

function initialTheme(): Theme {
  try {
    return localStorage.getItem('career-ops-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// ---- Package 3.3: Discover page (pasted JD intake and scanning). Deterministic: no LLM here.

interface DiscoverCaps {
  nonce: string;
  intake: boolean;
  taskDispatch: boolean;
}

const MIN_JD_CHARS = 100;

/** Fill a field from a fetch only when it is empty or still holds the last fetched value. */
function fillFetched(current: string, last: string | null, next: string | null): string {
  if (next === null || next === '') return current;
  return current.trim() === '' || current === last ? next : current;
}

/** Prepend a `Location: …` line when the fetched text does not already mention the location. */
function withLocation(text: string, location: string | null): string {
  const place = location?.trim();
  if (!place || text.toLowerCase().includes(place.toLowerCase())) return text;
  return `Location: ${place}

${text}`;
}

const intakeFieldMessages: Record<string, string> = {
  url: 'Enter a full http or https link.',
  company: 'Check the company name.',
  role: 'Check the role title.',
  text: 'The description was not accepted. Check that it is long enough and complete.',
};

// The server only says "Invalid value." per field, so show a plain message for each known field.
function intakeFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiFailure) || !error.fields) return {};
  return Object.fromEntries(
    Object.keys(error.fields).map(key => [key, intakeFieldMessages[key] ?? 'Check this value.']),
  );
}

/** DISCOVERY_BUSY carries current.activeRunId (null when another intake holds the lock). */
function activeRunId(error: unknown): string | null {
  if (!(error instanceof ApiFailure) || !isObject(error.current)) return null;
  const value = error.current.activeRunId;
  return typeof value === 'string' && value ? value : null;
}

/** DUPLICATE_JOB carries current.tracked, the job that already uses the link. */
function trackedJob(error: unknown): IntakeCheck['tracked'] {
  if (!(error instanceof ApiFailure) || !isObject(error.current)) return null;
  const tracked = error.current.tracked;
  return isObject(tracked) && typeof tracked.id === 'string'
    ? (tracked as NonNullable<IntakeCheck['tracked']>)
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the tracked job's status is, and for a Discarded one when and why it was discarded. */
function useTrackedStatusLine(job: NonNullable<IntakeCheck['tracked']>) {
  const [line, setLine] = useState(job.status);
  useEffect(() => {
    setLine(job.status);
    if (job.status !== 'Discarded') return;
    const controller = new AbortController();
    api.jobDetail(job.id, controller.signal).then(
      result => {
        if (controller.signal.aborted) return;
        const latest = [...result.data.history]
          .filter(entry => entry.newStatus === 'Discarded')
          .sort((a, b) =>
            (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt),
          )[0];
        if (!latest) return;
        const when = new Date(latest.occurredAt ?? latest.createdAt);
        const date = Number.isNaN(when.getTime())
          ? ''
          : ` on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(when)}`;
        setLine(`Discarded${date}${latest.reason ? `: ${latest.reason}` : ''}`);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [job.id, job.status]);
  return line;
}

function TrackedNotice({
  job,
  children,
}: {
  job: NonNullable<IntakeCheck['tracked']>;
  children?: ReactNode;
}) {
  const line = useTrackedStatusLine(job);
  return (
    <div className="notice notice-warn" role="alert">
      <p>
        This posting is already tracked as job #{job.id} ({line}). Open it to change its status.{' '}
        <a className="in-page-link" href={`#/jobs/${job.id}`}>
          Open that job ({job.company} – {job.role})
        </a>
        {children}
      </p>
    </div>
  );
}

function PasteForm({ nonce, onAdded }: { nonce: string; onAdded?: () => void }) {
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<
    { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; result: IntakeCheck }
  >({ kind: 'idle' });
  const [force, setForce] = useState(false);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ key: string; data: IntakePreview } | null>(null);
  const [busy, setBusy] = useState<'check' | 'fetch' | 'preview' | 'add' | null>(null);
  const [fetchWarnings, setFetchWarnings] = useState<string[]>([]);
  const [fetchAfterConfirm, setFetchAfterConfirm] = useState(false);
  const lastFetched = useRef<{ company: string | null; role: string | null; text: string | null }>({
    company: null,
    role: null,
    text: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ job: IntakeCheck['tracked'] } | null>(null);
  const [seenPrompt, setSeenPrompt] = useState(false);
  const [busyRun, setBusyRun] = useState<string | null | undefined>(undefined);
  const [added, setAdded] = useState<IntakeResult | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  const tracked = check.kind === 'done' ? check.result.tracked : null;
  const seen = check.kind === 'done' ? check.result.seen : null;
  const needsConfirm = (seen !== null && !force) || seenPrompt;
  // A scan-only link found by the check asks first; one the server reports later keeps the form
  // (and what was typed) on screen while the confirmation is shown.
  const open = check.kind === 'done' && !tracked && !duplicate && !(seen !== null && !force);
  const inputKey = JSON.stringify([url.trim(), company.trim(), role.trim(), text, force]);

  // Suggestions follow the company field, as the TUI does (1 to 100 characters).
  useEffect(() => {
    const value = company.trim();
    if (!open || !value || value.length > 100) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.intakeCompanies(value, controller.signal).then(
        result => {
          if (!controller.signal.aborted) setSuggestions(result.data.companies.slice(0, 10));
        },
        () => {
          if (!controller.signal.aborted) setSuggestions([]);
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [company, open]);

  const resetCheck = () => {
    setCheck({ kind: 'idle' });
    setForce(false);
    setSeenPrompt(false);
    setDuplicate(null);
    setPreview(null);
    setBusyRun(undefined);
    setNotice(null);
    setFetchAfterConfirm(false);
  };

  const handleFailure = (failure: unknown) => {
    setPreview(null);
    if (failure instanceof ApiFailure && failure.code === 'DUPLICATE_JOB') {
      setDuplicate({ job: trackedJob(failure) });
      setNotice(null);
    } else if (failure instanceof ApiFailure && failure.code === 'SEEN_URL') {
      setSeenPrompt(true);
      setNotice(null);
    } else if (failure instanceof ApiFailure && failure.code === 'DISCOVERY_BUSY') {
      setBusyRun(activeRunId(failure));
      setNotice(null);
    } else {
      const fields = intakeFieldErrors(failure);
      setErrors(fields);
      setNotice(
        failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED'
          ? 'The local session is no longer valid. Reload the page and try again. Nothing was added.'
          : failure instanceof ApiFailure
            ? failure.message
            : 'The request failed.',
      );
    }
  };

  const runCheck = async () => {
    const value = url.trim();
    if (!value) {
      setErrors({ url: 'Paste the job posting link first.' });
      return;
    }
    setErrors({});
    resetCheck();
    setBusy('check');
    try {
      const result = await api.intakeCheck(value, nonce, new AbortController().signal);
      setCheck({ kind: 'done', result: result.data });
    } catch (failure) {
      setCheck({ kind: 'idle' });
      handleFailure(failure);
    } finally {
      setBusy(null);
    }
  };

  // Read the page and fill the form. Only empty fields, or fields still holding the previous
  // fetched value, are filled; a refusal shows under the link and the form stays editable.
  const fetchFields = async (value: string) => {
    setBusy('fetch');
    setFetchWarnings([]);
    try {
      const fetched = (await api.intakeFetch(value, nonce, new AbortController().signal)).data;
      const nextText = fetched.text === null ? null : withLocation(fetched.text, fetched.location);
      const last = lastFetched.current;
      setCompany(current => fillFetched(current, last.company, fetched.company));
      setRole(current => fillFetched(current, last.role, fetched.role));
      setText(current => fillFetched(current, last.text, nextText));
      lastFetched.current = {
        company: fetched.company ?? last.company,
        role: fetched.role ?? last.role,
        text: nextText ?? last.text,
      };
      setFetchWarnings(fetched.warnings);
    } catch (failure) {
      setErrors({
        url:
          failure instanceof ApiFailure
            ? failure.code === 'LOCAL_REQUEST_REJECTED'
              ? 'The local session is no longer valid. Reload the page and try again.'
              : failure.message
            : 'The fetch failed. Fill the fields by hand.',
      });
    } finally {
      setBusy(null);
    }
  };

  // Fetch: the duplicate check runs first. A tracked or scan-seen link shows its result and is not
  // fetched; a seen link is fetched only after the owner chooses "Add it anyway".
  const runFetch = async () => {
    const value = url.trim();
    if (!value) {
      setErrors({ url: 'Paste the job posting link first.' });
      return;
    }
    setErrors({});
    resetCheck();
    setFetchWarnings([]);
    setFetchAfterConfirm(false);
    setBusy('fetch');
    try {
      const checked = await api.intakeCheck(value, nonce, new AbortController().signal);
      setCheck({ kind: 'done', result: checked.data });
      if (checked.data.tracked) return;
      if (checked.data.seen) {
        setFetchAfterConfirm(true);
        return;
      }
    } catch (failure) {
      setCheck({ kind: 'idle' });
      handleFailure(failure);
      return;
    } finally {
      setBusy(null);
    }
    await fetchFields(value);
  };

  const validate = () => {
    const found: Record<string, string> = {};
    if (!company.trim()) found.company = 'Enter the company name.';
    if (!role.trim()) found.role = 'Enter the role title.';
    if (text.trim().length < MIN_JD_CHARS)
      found.text = `The job description needs at least ${MIN_JD_CHARS} characters (it has ${text.trim().length}).`;
    return found;
  };

  const body = (): IntakeInput => ({
    url: url.trim(),
    company: company.trim(),
    role: role.trim(),
    text,
    force,
  });

  const runPreview = async () => {
    const found = validate();
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy('preview');
    try {
      const result = await api.intakePreview(body(), nonce, new AbortController().signal);
      setPreview({ key: inputKey, data: result.data });
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(null);
    }
  };

  const runAdd = async () => {
    const found = validate();
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy('add');
    try {
      const result = await api.intake(body(), nonce, new AbortController().signal);
      setAdded(result.data);
      onAdded?.();
      setUrl('');
      setCompany('');
      setRole('');
      setText('');
      resetCheck();
      setErrors({});
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(null);
    }
  };

  const previewReady = preview !== null && preview.key === inputKey;
  const fieldsValid = Object.keys(validate()).length === 0;
  const err = (key: string) => errors[key];

  return (
    <section className="edit-card discover-card" aria-labelledby="paste-title">
      <h3 id="paste-title">Add a job from a pasted description</h3>
      <p className="pane-meta">
        Paste the posting link and press Fetch to fill the company, role and description, or check
        the link and paste them yourself. Review everything before adding. Nothing is rewritten or
        scored.
      </p>
      {added && (
        <div className="notice notice-ok" role="status">
          <p>
            Added job #{added.id}: {added.company} – {added.role}.{' '}
            <a className="in-page-link" href={`#/jobs/${added.id}`}>
              Open the job workspace
            </a>
          </p>
        </div>
      )}

      <div className="paste-step">
        <label htmlFor="paste-url">Posting link</label>
        <div className="url-row">
          <input
            id="paste-url"
            type="url"
            ref={urlRef}
            value={url}
            disabled={busy !== null}
            placeholder="https://…"
            aria-invalid={Boolean(err('url'))}
            aria-describedby={err('url') ? 'paste-url-error' : undefined}
            onChange={event => {
              setUrl(event.target.value);
              if (check.kind !== 'idle' || duplicate || seenPrompt) resetCheck();
              setAdded(null);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runFetch();
              }
            }}
          />
          <button
            className="primary-button"
            disabled={busy !== null || !url.trim()}
            onClick={() => void runFetch()}
          >
            {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {err('url') && (
          <p className="field-error" id="paste-url-error" role="alert">
            {err('url')}
          </p>
        )}
        {fetchWarnings.length > 0 && <p className="pane-meta">{fetchWarnings.join(' ')}</p>}
        <div className="edit-actions">
          <button
            className="quiet-button"
            disabled={busy !== null || !url.trim()}
            onClick={() => void runCheck()}
          >
            {busy === 'check' ? 'Checking…' : 'Check link'}
          </button>
        </div>
      </div>

      {tracked && <TrackedNotice job={tracked} />}
      {duplicate && !tracked && duplicate.job && (
        <TrackedNotice job={duplicate.job}>
          {' '}
          Your text is kept; change the link to continue.
        </TrackedNotice>
      )}
      {duplicate && !tracked && !duplicate.job && (
        <div className="notice notice-warn" role="alert">
          <p>
            This link is already a tracked job and cannot be added again. Your text is kept; change
            the link to continue.
          </p>
        </div>
      )}
      {needsConfirm && !tracked && !duplicate && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              {seen
                ? `This link was seen in a scan: ${seen.company} – ${seen.title} (${seen.status}), first seen ${seen.firstSeen}. It is not a tracked job yet.`
                : 'This link was seen in an earlier scan but is not a tracked job.'}{' '}
              Add it anyway?
            </p>
            <div className="edit-actions">
              <button
                className="primary-button"
                onClick={() => {
                  setForce(true);
                  setSeenPrompt(false);
                  if (fetchAfterConfirm) {
                    setFetchAfterConfirm(false);
                    void fetchFields(url.trim());
                  }
                }}
              >
                Add it anyway
              </button>
              <button className="quiet-button" onClick={resetCheck}>
                Use a different link
              </button>
            </div>
          </div>
        </div>
      )}
      {check.kind === 'done' && check.result.url && check.result.url !== url.trim() && (
        <p className="pane-meta">Link as it will be stored: {check.result.url}</p>
      )}

      {open && (
        <div className="paste-step">
          <label>
            Company
            <input
              type="text"
              list="company-suggestions"
              value={company}
              disabled={busy !== null}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(err('company'))}
              aria-describedby={err('company') ? 'paste-company-error' : undefined}
              onChange={event => {
                setCompany(event.target.value);
              }}
            />
          </label>
          <datalist id="company-suggestions">
            {suggestions.map(name => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {err('company') && (
            <p className="field-error" id="paste-company-error" role="alert">
              {err('company')}
            </p>
          )}
          <label>
            Role
            <input
              type="text"
              value={role}
              disabled={busy !== null}
              aria-invalid={Boolean(err('role'))}
              aria-describedby={err('role') ? 'paste-role-error' : undefined}
              onChange={event => {
                setRole(event.target.value);
              }}
            />
          </label>
          {err('role') && (
            <p className="field-error" id="paste-role-error" role="alert">
              {err('role')}
            </p>
          )}
          <label>
            Job description (kept exactly as pasted)
            <textarea
              className="doc-edit"
              value={text}
              spellCheck={false}
              disabled={busy !== null}
              aria-invalid={Boolean(err('text'))}
              aria-describedby="paste-text-count"
              onChange={event => {
                setText(event.target.value);
              }}
            />
          </label>
          <p
            className={err('text') ? 'field-error' : 'pane-meta'}
            id="paste-text-count"
            role={err('text') ? 'alert' : undefined}
          >
            {err('text') ?? `${text.trim().length} of ${MIN_JD_CHARS} characters minimum`}
          </p>
          {previewReady && preview && (
            <div className="notice notice-ok" role="status">
              <p>
                Preview: <strong>{preview.data.company}</strong> – {preview.data.role}. The
                description would be stored as {preview.data.jdPath}. Nothing has been saved yet.
              </p>
            </div>
          )}
          <div className="edit-actions">
            <button
              className="primary-button"
              disabled={busy !== null || seenPrompt || !fieldsValid}
              onClick={() => void runAdd()}
            >
              {busy === 'add' ? 'Adding…' : 'Add job'}
            </button>
            <button
              className="quiet-button"
              disabled={busy !== null || seenPrompt || !fieldsValid}
              onClick={() => void runPreview()}
            >
              {busy === 'preview' ? 'Checking…' : 'Preview (optional)'}
            </button>
          </div>
        </div>
      )}
      {busyRun !== undefined && (
        <div className="notice notice-warn" role="alert">
          <p>
            A scan or another intake is already running, so nothing was added. Your input is kept.
            {busyRun ? ` Active scan: ${busyRun}.` : ' Another intake is in progress.'} Try again
            when it finishes.
          </p>
        </div>
      )}
      {notice && (
        <div className="notice notice-error" role="alert">
          <p>{notice}</p>
        </div>
      )}
    </section>
  );
}

const summaryLabels: [keyof ScanReport['summary'], string][] = [
  ['jobsFound', 'Jobs found'],
  ['newOffers', 'New offers'],
  ['missingFullJd', 'Missing full JD'],
  ['structured', 'Structured sources'],
  ['richOnly', 'Rich-only sources'],
  ['unclassified', 'Unclassified'],
  ['ok', 'Sources ok'],
  ['empty', 'Sources empty'],
  ['error', 'Sources with errors'],
];

function ScanCard({ nonce }: { nonce: string }) {
  const [company, setCompany] = useState('');
  const [run, setRun] = useState<RunRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [report, setReport] = useState<
    { kind: 'none' } | { kind: 'loading' } | { kind: 'ok'; value: ScanReport } | { kind: 'error' }
  >({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<{ text: string; offset: number }>({ text: '', offset: 0 });
  const active = run !== null && (run.state === 'queued' || run.state === 'running');

  // Find the most recent scan run on first load.
  useEffect(() => {
    const controller = new AbortController();
    api.runs(controller.signal).then(
      result => {
        if (controller.signal.aborted) return;
        const scans = result.data.runs
          .filter(item => item.action === 'scan')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (scans[0]) setRun(scans[0]);
        setLoaded(true);
      },
      () => {
        if (!controller.signal.aborted) setLoaded(true);
      },
    );
    return () => controller.abort();
  }, []);

  // Poll the run while it is queued or running.
  useEffect(() => {
    if (!run || !active) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      api.run(run.id, controller.signal).then(
        result => {
          if (!controller.signal.aborted) setRun(result.data.run);
        },
        () => undefined,
      );
    }, 2000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [run?.id, active]);

  // Read the report once a run completes.
  useEffect(() => {
    if (!run || run.state !== 'completed') {
      setReport({ kind: 'none' });
      return;
    }
    const controller = new AbortController();
    setReport({ kind: 'loading' });
    api.scanReport(run.id, controller.signal).then(
      result => {
        if (!controller.signal.aborted) setReport({ kind: 'ok', value: result.data });
      },
      () => {
        if (!controller.signal.aborted) setReport({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [run?.id, run?.state]);

  // Tail the log while it is open (and keep following a running scan).
  useEffect(() => {
    if (!run || !logOpen) return;
    const controller = new AbortController();
    let offset = 0;
    let cancelled = false;
    setLog({ text: '', offset: 0 });
    const pull = () => {
      api.runLog(run.id, offset, controller.signal).then(
        result => {
          if (cancelled) return;
          offset = result.data.nextOffset;
          setLog(previous => ({
            text: (previous.text + result.data.text).slice(-20000),
            offset,
          }));
        },
        () => undefined,
      );
    };
    pull();
    const timer = active ? window.setInterval(pull, 2000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      controller.abort();
    };
  }, [run?.id, logOpen, active]);

  const start = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    setBusyNote(null);
    try {
      const result = await api.startScan(
        {
          action: 'scan',
          requestKey: `scan-${crypto.randomUUID()}`,
          dryRun: dry,
          ...(company.trim() ? { company: company.trim() } : {}),
        },
        nonce,
        new AbortController().signal,
      );
      setDryRun(dry);
      setRun(result.data.runs[0]);
      setLog({ text: '', offset: 0 });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'DISCOVERY_BUSY') {
        const id = activeRunId(failure);
        setBusyNote(
          id
            ? `A scan or intake is already running (run ${id}). Showing it below.`
            : 'A scan or intake is already running. Try again when it finishes.',
        );
        if (id) {
          try {
            const existing = await api.run(id, new AbortController().signal);
            setRun(existing.data.run);
          } catch {
            /* the note above is enough */
          }
        }
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError('The local session is no longer valid. Reload the page and try again.');
      } else {
        setError(
          failure instanceof ApiFailure ? failure.message : 'The scan could not be started.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const reportValue = report.kind === 'ok' ? report.value : null;
  const summary = reportValue ? reportValue.summary : null;
  const missing = report.kind === 'ok' ? report.value.missing : [];
  return (
    <section className="edit-card discover-card" aria-labelledby="scan-title">
      <h3 id="scan-title">Scan portals</h3>
      <p className="pane-meta">
        A dry run shows what a scan would find without saving anything. A real scan adds new
        postings and runs in the background.
      </p>
      <label className="scan-filter">
        Company filter (optional)
        <input
          type="text"
          value={company}
          disabled={busy || active}
          placeholder="Leave empty to scan everything"
          maxLength={100}
          onChange={event => setCompany(event.target.value)}
        />
      </label>
      <div className="edit-actions">
        <button className="quiet-button" disabled={busy || active} onClick={() => void start(true)}>
          Dry-run scan
        </button>
        <button
          className="primary-button"
          disabled={busy || active}
          onClick={() => void start(false)}
        >
          Run scan
        </button>
      </div>
      {busyNote && (
        <div className="notice notice-warn" role="alert">
          <p>{busyNote}</p>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {!loaded && (
        <p className="pane-meta" role="status">
          Looking for the last scan…
        </p>
      )}
      {loaded && !run && <p className="missing-copy">No scan has been run yet.</p>}
      {run && (
        <div className="run-state" role="status" aria-live="polite">
          <p>
            <strong>
              {run.state === 'queued' && 'Scan queued'}
              {run.state === 'running' && 'Scan running'}
              {run.state === 'completed' && 'Scan finished'}
              {run.state === 'failed' && 'Scan failed'}
              {run.state === 'interrupted' && 'Scan interrupted'}
            </strong>
            {(dryRun === true || reportValue?.dryRun === true) && ' (dry run)'}
            {` · step: ${run.phase}`}
            {run.errorCode ? ` · ${errorText(run.errorCode)}` : ''}
          </p>
          <p className="pane-meta">
            Started {formatDateTime(run.startedAt ?? run.createdAt)}
            {run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ''}
          </p>
          <button
            className="quiet-button"
            aria-expanded={logOpen}
            onClick={() => setLogOpen(!logOpen)}
          >
            {logOpen ? 'Hide log tail' : 'Show log tail'}
          </button>
          {logOpen && (
            <pre className="doc-text log-tail" tabIndex={0} aria-label="Scan log tail">
              {log.text || 'The log is empty so far.'}
            </pre>
          )}
        </div>
      )}
      {report.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading the scan report…
        </p>
      )}
      {report.kind === 'error' && run?.state === 'completed' && (
        <p className="missing-copy">The scan finished but its report could not be read.</p>
      )}
      {summary && (
        <div className="scan-report">
          <h4>Last scan summary</h4>
          <dl className="report-summary">
            {summaryLabels.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{summary[key]}</dd>
              </div>
            ))}
          </dl>
          {reportValue && (
            <p className="pane-meta">
              {reportValue.dryRun ? 'Dry run: nothing was saved. ' : 'Real scan. '}Generated{' '}
              {formatDateTime(reportValue.generatedAt)}.
            </p>
          )}
          {reportValue && reportValue.companies.length > 0 && (
            <details>
              <summary>Per-company results ({reportValue.companies.length})</summary>
              <div
                className="table-scroll"
                role="region"
                aria-label="Per-company scan results"
                tabIndex={0}
              >
                <table className="history-table">
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col">Status</th>
                      <th scope="col">Provider</th>
                      <th scope="col">Jobs</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportValue.companies.map((row, index) => (
                      <tr key={`${row.company}-${index}`}>
                        <td>{row.company}</td>
                        <td>{row.status}</td>
                        <td>{row.provider ?? '—'}</td>
                        <td>{row.jobsFound}</td>
                        <td>{row.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <h4>Missing full JD</h4>
          {missing.length === 0 ? (
            <p className="missing-copy">Nothing was deferred for a missing full description.</p>
          ) : (
            <>
              <p className="pane-meta">
                These postings were not saved because no full job description could be found.
              </p>
              <ul className="file-list">
                {missing.map((item, index) => (
                  <li key={`${item.url}-${index}`}>
                    <div>
                      <strong>{item.company || 'Company missing'}</strong>
                      <span>{item.title || 'Title missing'}</span>
                    </div>
                    {/^https?:\/\//i.test(item.url) && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        Posting
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DiscoverPage({ caps }: { caps: DiscoverCaps | null }) {
  if (!caps)
    return (
      <section className="capability-card">
        <div>
          <span className="card-kicker">CURRENT AVAILABILITY</span>
          <h2>Discover is waiting for the local session</h2>
          <p>The page shows its tools once the service reports what this server supports.</p>
        </div>
        <span className="not-enabled">Unavailable</span>
      </section>
    );
  if (!caps.intake && !caps.taskDispatch)
    return (
      <section className="capability-card">
        <div>
          <span className="card-kicker">CURRENT AVAILABILITY</span>
          <h2>Discover is unavailable</h2>
          <p>This server does not offer pasted intake or scanning.</p>
        </div>
        <span className="not-enabled">Unavailable</span>
      </section>
    );
  return (
    <div className="discover-grid">
      {caps.intake && <PasteForm nonce={caps.nonce} />}
      {caps.taskDispatch && <ScanCard nonce={caps.nonce} />}
    </div>
  );
}

// ---- Package 3.7: Providers page (subscription provider and model per LLM function).
// Never asks for a password or token: logins happen locally through the provider's own CLI.

const providerLabels: Record<ProviderKey, string> = { claude: 'Claude', codex: 'OpenAI' };

const OTHER_MODEL = '__other__';

// Switching provider keeps the model only when the new provider lists it; otherwise it falls back
// to that provider's first model.
function modelAfterProviderChange(
  models: ProviderSettings['models'] | undefined,
  provider: ProviderKey,
  current: string,
) {
  const list: string[] = models?.[provider] ?? [];
  if (list.length === 0 || list.includes(current)) return current;
  return list[0];
}

// A dropdown of the provider's models plus "Other…", which reveals the free-text input. A value that
// is not in the list (a configured custom model) selects "Other…" and stays visible.
function ModelField({
  id,
  provider,
  models,
  value,
  disabled,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  provider: ProviderKey;
  models: ProviderSettings['models'] | undefined;
  value: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  onChange: (model: string) => void;
}) {
  const list: string[] = models?.[provider] ?? [];
  const [forceOther, setForceOther] = useState(false);
  useEffect(() => setForceOther(false), [provider]);
  const other = forceOther || list.length === 0 || !list.includes(value);
  return (
    <>
      <label>
        Model
        <select
          id={`${id}-model-select`}
          value={other ? OTHER_MODEL : value}
          disabled={disabled}
          onChange={event => {
            if (event.target.value === OTHER_MODEL) {
              setForceOther(true);
            } else {
              setForceOther(false);
              onChange(event.target.value);
            }
          }}
        >
          {list.map(model => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
          <option value={OTHER_MODEL}>Other…</option>
        </select>
      </label>
      {other && (
        <label>
          Other model name
          <input
            id={`${id}-model`}
            type="text"
            value={value}
            maxLength={80}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={event => onChange(event.target.value)}
          />
        </label>
      )}
    </>
  );
}
const loginCommands: Record<ProviderKey, string> = {
  claude: 'claude auth login',
  codex: 'codex login',
};
const functionRows: { key: ProviderFunctionName; label: string; hint: string }[] = [
  { key: 'evaluation', label: 'Evaluation', hint: 'Scores a job against the rubric.' },
  {
    key: 'companyResearch',
    label: 'Company research',
    hint: 'Looks up the company during evaluation.',
  },
  { key: 'cv', label: 'CV', hint: 'Drafts a tailored CV.' },
  { key: 'coverLetter', label: 'Cover letter', hint: 'Drafts a cover letter.' },
];
const readinessText: Record<ReadinessState, string> = {
  ready: 'Ready',
  notLoggedIn: 'Not logged in',
  unavailable: 'Unavailable',
  unknown: 'Not checked yet',
};

function validateModel(value: string): string | null {
  const model = value.trim();
  if (!model) return 'Enter a model name.';
  if (Array.from(model).length > 80) return 'Keep the model name to 80 characters or fewer.';
  if (/[\u0000-\u001f\u007f]/.test(value))
    return 'The model name cannot contain control characters.';
  return null;
}

function ProviderRow({
  row,
  stored,
  revision,
  models,
  nonce,
  onSaved,
  reload,
}: {
  row: (typeof functionRows)[number];
  stored: ProviderFunctionSetting;
  models: ProviderSettings['models'];
  revision: string;
  nonce: string | null;
  onSaved: (next: ProviderSettings) => void;
  reload: () => Promise<ProviderSettings | null>;
}) {
  const [provider, setProvider] = useState<ProviderKey>(stored.provider);
  const [model, setModel] = useState(stored.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ProviderFunctionSetting | null>(null);
  const [saved, setSaved] = useState(false);
  const lastStored = useRef(stored);
  const dirty = provider !== stored.provider || model.trim() !== stored.model;
  const id = `provider-${row.key}`;

  // Follow the stored value while the row has no unsaved input; never overwrite typed input.
  useEffect(() => {
    const previous = lastStored.current;
    const wasClean = provider === previous.provider && model === previous.model;
    lastStored.current = stored;
    if (wasClean) {
      setProvider(stored.provider);
      setModel(stored.model);
    }
  }, [stored.provider, stored.model]);

  const save = async () => {
    const invalid = validateModel(model);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!nonce) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.saveProvider(
        row.key,
        { expectedRevision: revision, provider, model: model.trim() },
        nonce,
        new AbortController().signal,
      );
      onSaved(result.data);
      setConflict(null);
      setSaved(true);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'SETTINGS_CONFLICT') {
        const fresh = await reload();
        setConflict(fresh ? fresh.functions[row.key] : null);
        if (!fresh)
          setError(
            'The settings changed elsewhere. Reload the page to see them. Your input is kept.',
          );
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError(
          'The local session is no longer valid, so nothing was saved. Reload the page and try again.',
        );
      } else {
        setError(
          failure instanceof ApiFailure && failure.fields?.model
            ? 'Check the model name.'
            : failure instanceof ApiFailure
              ? failure.message
              : 'The change could not be saved.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="provider-row">
      <div className="provider-row-head">
        <div>
          <h3>{row.label}</h3>
          <p className="pane-meta">{row.hint}</p>
        </div>
        <span className={stored.source === 'file' ? 'source-badge' : 'source-badge is-legacy'}>
          {stored.source === 'file' ? 'Saved setting' : 'From existing config, not saved yet'}
        </span>
      </div>
      <div className="provider-fields">
        <label>
          Provider
          <select
            id={`${id}-provider`}
            value={provider}
            disabled={busy || !nonce}
            onChange={event => {
              const next = event.target.value as ProviderKey;
              setProvider(next);
              setModel(modelAfterProviderChange(models, next, model));
              setSaved(false);
            }}
          >
            <option value="claude">Claude</option>
            <option value="codex">OpenAI</option>
          </select>
        </label>
        <ModelField
          id={id}
          provider={provider}
          models={models}
          value={model}
          disabled={busy || !nonce}
          invalid={Boolean(error)}
          describedBy={error ? `${id}-error` : undefined}
          onChange={next => {
            setModel(next);
            setSaved(false);
          }}
        />
        {nonce && (
          <button
            className="primary-button"
            disabled={busy || !dirty}
            aria-label={`Save ${row.label}`}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              These settings changed elsewhere. Stored now:{' '}
              <strong>
                {providerLabels[conflict.provider]} / {conflict.model}
              </strong>
              . Your input is kept above.
            </p>
            <div className="edit-actions">
              <button
                className="quiet-button"
                onClick={() => {
                  setProvider(conflict.provider);
                  setModel(conflict.model);
                  setConflict(null);
                  setError(null);
                }}
              >
                Use stored value
              </button>
              <span className="pane-meta">Or choose Save to replace it with your input.</span>
            </div>
          </div>
        </div>
      )}
      {saved && !dirty && (
        <p className="success-copy" role="status">
          {row.label} saved.
        </p>
      )}
    </li>
  );
}

function ProvidersPage({ nonce }: { nonce: string | null }) {
  const [state, setState] = useState<EndpointState<ProviderSettings>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const reload = async (): Promise<ProviderSettings | null> => {
    try {
      const fresh = await api.providerSettings(new AbortController().signal);
      setState({ kind: 'success', value: fresh.data });
      return fresh.data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api.providerSettings(controller.signal).then(
      value => {
        if (!controller.signal.aborted) setState({ kind: 'success', value: value.data });
      },
      error => {
        if (!controller.signal.aborted)
          setState({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => controller.abort();
  }, [retry]);

  const checkLogins = async () => {
    if (!nonce) return;
    setChecking(true);
    setCheckError(null);
    try {
      const readiness = await api.checkProviderReadiness(nonce, new AbortController().signal);
      setState(previous =>
        previous.kind === 'success'
          ? { kind: 'success', value: { ...previous.value, readiness } }
          : previous,
      );
    } catch (failure) {
      setCheckError(
        failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED'
          ? 'The local session is no longer valid. Reload the page and try again.'
          : failure instanceof ApiFailure
            ? failure.message
            : 'The login check could not run.',
      );
    } finally {
      setChecking(false);
    }
  };

  // The login check is bounded and sends no prompt, so it runs once when the page opens.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (state.kind !== 'success' || !nonce || autoChecked.current) return;
    autoChecked.current = true;
    void checkLogins();
  }, [state.kind, nonce]);

  if (state.kind === 'loading')
    return (
      <section className="empty-state" role="status">
        <span className="spinner" aria-hidden="true" /> Loading provider settings…
      </section>
    );
  if (state.kind === 'error') {
    const unavailable = [
      'DATABASE_UNAVAILABLE',
      'SCHEMA_NOT_READY',
      'SETTINGS_UNAVAILABLE',
      'SETTINGS_UNREADABLE',
    ].includes(state.error.code);
    return (
      <div className={`notice ${unavailable ? 'notice-warn' : 'notice-error'}`} role="alert">
        <div>
          <strong>Provider settings could not be loaded.</strong>
          <p>{state.error.message}</p>
        </div>
        <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
          Retry
        </button>
      </div>
    );
  }
  const settings = state.value;
  return (
    <div className="providers-page">
      <section className="edit-card" aria-labelledby="provider-functions-title">
        <h2 id="provider-functions-title">Provider and model for each task</h2>
        <p className="pane-meta">
          Choose which subscription each task uses. Saving a row writes all four tasks to the
          settings file. A single run can still override these choices later.
        </p>
        <ul className="provider-list">
          {functionRows.map(row => (
            <ProviderRow
              key={row.key}
              row={row}
              stored={settings.functions[row.key]}
              models={settings.models}
              revision={settings.revision}
              nonce={nonce}
              reload={reload}
              onSaved={next =>
                setState(previous =>
                  previous.kind === 'success'
                    ? { kind: 'success', value: { ...previous.value, ...next } }
                    : previous,
                )
              }
            />
          ))}
        </ul>
        {!nonce && (
          <p className="missing-copy">Editing is unavailable until the local session loads.</p>
        )}
      </section>

      <section className="edit-card" aria-labelledby="readiness-title">
        <div className="section-heading">
          <div>
            <h2 id="readiness-title">Subscription logins</h2>
            <p className="pane-meta">
              The check asks each command line tool whether it is signed in. It does not send a
              prompt or use any credits.
            </p>
          </div>
          {nonce && (
            <button className="quiet-button" disabled={checking} onClick={() => void checkLogins()}>
              {checking ? 'Checking…' : 'Check logins'}
            </button>
          )}
        </div>
        {checkError && (
          <div className="notice notice-error" role="alert">
            <p>{checkError}</p>
          </div>
        )}
        <ul className="readiness-list" aria-live="polite">
          {(['claude', 'codex'] as const).map(key => {
            const item = settings.readiness[key];
            return (
              <li key={key} className="readiness-row">
                <div>
                  <h3>{providerLabels[key]}</h3>
                  <p className="pane-meta">
                    {item.checkedAt
                      ? `Checked ${formatDateTime(item.checkedAt)}`
                      : checking
                        ? 'Checking now…'
                        : 'Use Check logins to test it.'}
                  </p>
                </div>
                <span className={`readiness-badge readiness-${item.state}`}>
                  {readinessText[item.state]}
                </span>
                {item.message && <p className="readiness-message">{item.message}</p>}
                {item.state !== 'ready' && (
                  <p className="readiness-help">
                    {item.state === 'unavailable'
                      ? `The ${key} command could not be run. Check that it is installed on this computer. `
                      : ''}
                    To sign in, run <code>{loginCommands[key]}</code> in a terminal on this
                    computer, then choose Check logins. This page never asks for a password or
                    token.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function usePage(): [PageId, string | null, (page: PageId) => void] {
  const parse = (): { page: PageId; jobId: string | null } => {
    const route = location.hash.slice(1).replace(/^\//, '');
    const workspace = /^jobs\/([^/?#]+)$/.exec(route);
    if (workspace) return { page: 'jobs', jobId: workspace[1] };
    return {
      page: pages.some(page => page.id === route) ? (route as PageId) : 'overview',
      jobId: null,
    };
  };
  const [{ page, jobId }, setPage] = useState(parse);
  useEffect(() => {
    const onHash = () => setPage(parse());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    if (!location.hash) location.hash = '/overview';
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  return [
    page,
    jobId,
    next => {
      location.hash = `/${next}`;
    },
  ];
}

function useConnection(refreshKey: number) {
  const [health, setHealth] = useState<EndpointState<HealthResponse>>({ kind: 'loading' });
  const [ready, setReady] = useState<EndpointState<ReadyResponse>>({ kind: 'loading' });
  const [session, setSession] = useState<EndpointState<SessionResponse>>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setHealth({ kind: 'loading' });
    setReady({ kind: 'loading' });
    setSession({ kind: 'loading' });
    const load = async <T,>(
      request: (signal: AbortSignal) => Promise<T>,
      update: (state: EndpointState<T>) => void,
    ) => {
      try {
        update({ kind: 'success', value: await request(controller.signal) });
      } catch (error) {
        if (!controller.signal.aborted)
          update({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      }
    };
    void load(api.health, setHealth);
    void load(api.ready, setReady);
    void load(api.session, setSession);
    return () => controller.abort();
  }, [refreshKey]);
  return { health, ready, session };
}

// The message is what a person reads; the code and request id sit behind a Details toggle.
function ErrorDetails({ error }: { error: ApiFailure }) {
  return (
    <details className="error-details">
      <summary>Details</summary>
      <span>Code: {error.code}</span>
      {error.requestId && <span>Request ID: {error.requestId}</span>}
    </details>
  );
}

type Connection = {
  health: EndpointState<HealthResponse>;
  ready: EndpointState<ReadyResponse>;
  session: EndpointState<SessionResponse>;
};

const capabilityLabels: [keyof SessionResponse['data']['capabilities'], string][] = [
  ['jobReads', 'Job browsing'],
  ['jobDetail', 'Job workspace'],
  ['jobWrites', 'Editing'],
  ['intake', 'Add a job and scan'],
  ['providerSettings', 'Provider settings'],
  ['taskDispatch', 'Background runs'],
];

type StampedState = EndpointState<{ meta: { requestId: string; observedAt: string } }>;

function ServicePage({
  connection,
  loading,
  onRefresh,
}: {
  connection: Connection;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { health, ready, session } = connection;
  const rows: { name: string; state: StampedState }[] = [
    { name: 'Application health', state: health },
    { name: 'Database readiness', state: ready },
    { name: 'Dashboard session', state: session },
  ];
  const sessionData = session.kind === 'success' ? session.value.data : null;
  const relation = sessionData ? buildRelation(sessionData.build) : 'same';
  const describeBuild = (value: string) =>
    value === 'dev' ? 'Development (not a built copy)' : formatDateTime(value);
  const dispatchReason = (reason: string | null) =>
    reason === 'notConfigured'
      ? 'Not configured'
      : reason === 'notAvailable'
        ? 'Not available'
        : 'Ready';
  return (
    <div className="service-page">
      <section className="connection-summary" aria-label="Service status">
        <div className="section-heading">
          <div>
            <h2>Service status</h2>
            <p>Health, readiness and session checks.</p>
          </div>
          <button className="quiet-button" onClick={onRefresh} disabled={loading}>
            Refresh status
          </button>
        </div>
        <div className="status-grid">
          <EndpointCard title="Application health" state={health} />
          <EndpointCard title="Database readiness" state={ready} />
          <EndpointCard title="Dashboard session" state={session} />
        </div>
        {health.kind === 'success' && ready.kind === 'error' && (
          <div className="notice notice-warn" role="status">
            <div>
              <strong>Database readiness is unavailable.</strong>
              <p>{ready.error.message} Check your database connection, then retry.</p>
            </div>
            <button onClick={onRefresh} disabled={loading}>
              Retry readiness
            </button>
          </div>
        )}
      </section>
      <section className="panel-card" aria-labelledby="service-db-title">
        <h2 id="service-db-title">Database</h2>
        <dl className="service-facts">
          <div>
            <dt>Connection</dt>
            <dd>
              {ready.kind === 'success'
                ? 'Ready'
                : ready.kind === 'error'
                  ? 'Unavailable'
                  : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>
              {ready.kind === 'success' ? 'Ready' : ready.kind === 'error' ? 'Unknown' : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Background runs</dt>
            <dd>
              {ready.kind === 'success'
                ? ready.value.data.taskDispatch.ready
                  ? 'Ready'
                  : dispatchReason(ready.value.data.taskDispatch.reason)
                : 'Unknown'}
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel-card" aria-labelledby="service-session-title">
        <h2 id="service-session-title">Session and build</h2>
        {sessionData ? (
          <dl className="service-facts">
            <div>
              <dt>API version</dt>
              <dd>{sessionData.apiVersion}</dd>
            </div>
            <div>
              <dt>Service build</dt>
              <dd>{describeBuild(sessionData.build)}</dd>
            </div>
            <div>
              <dt>This page was built</dt>
              <dd>{describeBuild(PAGE_BUILD)}</dd>
            </div>
            <div>
              <dt>Running copy</dt>
              <dd>
                {relation === 'same'
                  ? 'Current'
                  : relation === 'pageOlder'
                    ? 'This page is older than the service. ' + buildMessage(relation)
                    : 'The service is older than this page. ' + buildMessage(relation)}
              </dd>
            </div>
            {capabilityLabels.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{sessionData.capabilities[key] ? 'Available' : 'Not offered'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="missing-copy">
            {session.kind === 'loading' ? 'Checking…' : 'The session could not be read.'}
          </p>
        )}
      </section>
      <section className="panel-card" aria-labelledby="service-requests-title">
        <h2 id="service-requests-title">Request ids</h2>
        <p className="pane-meta">Quote these when reporting a problem.</p>
        <div className="table-scroll" role="region" aria-label="Request ids" tabIndex={0}>
          <table className="service-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
                <th scope="col">Request id</th>
                <th scope="col">Observed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, state }) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>
                    {state.kind === 'success'
                      ? 'Available'
                      : state.kind === 'error'
                        ? 'Unavailable'
                        : 'Checking'}
                  </td>
                  <td>
                    <code>
                      {state.kind === 'success'
                        ? state.value.meta.requestId
                        : state.kind === 'error'
                          ? (state.error.requestId ?? 'None (no reply)')
                          : '-'}
                    </code>
                  </td>
                  <td>
                    {state.kind === 'success' ? formatDateTime(state.value.meta.observedAt) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EndpointCard({ title, state }: { title: string; state: EndpointState<unknown> }) {
  if (state.kind === 'loading')
    return (
      <section className="status-card" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> <strong>{title}</strong>
        <span>Checking...</span>
      </section>
    );
  if (state.kind === 'error')
    return (
      <section className="status-card status-error">
        <span className="status-dot" />
        <strong>{title}</strong>
        <span>{state.error.message}</span>
        <ErrorDetails error={state.error} />
      </section>
    );
  return (
    <section className="status-card status-ok">
      <span className="status-dot" />
      <strong>{title}</strong>
      <span>Available</span>
    </section>
  );
}

// ---- Package 3.6: Tasks page, global active-run indicator and Start again.
// States are shown exactly as the server reports them. There is no Resume or Cancel: the launchers
// support neither. Start again opens the same dialog a first start uses and sends a fresh key.

const TASK_BASE_LIMIT = 12;
const TASK_MORE_LIMIT = 50;
const startAgainActions = ['evaluate', 'cv', 'letter', 'scan', 'publish'];

type RunsMonitor = {
  runs: RunRecord[];
  loaded: boolean;
  reconnecting: boolean;
  failed: boolean;
  refresh: () => void;
};

function useRunsMonitor(enabled: boolean, limit: number): RunsMonitor {
  const [state, setState] = useState({
    runs: [] as RunRecord[],
    loaded: false,
    reconnecting: false,
    failed: false,
  });
  const [tick, setTick] = useState(0);
  const activeRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await api.runs(controller.signal, undefined, limit);
        if (cancelled) return;
        activeRef.current = result.data.runs.some(isActiveRun);
        setState({ runs: result.data.runs, loaded: true, reconnecting: false, failed: false });
      } catch {
        if (cancelled) return;
        // A failed poll never clears what is already shown.
        setState(previous => ({
          ...previous,
          reconnecting: previous.loaded,
          failed: !previous.loaded,
        }));
      }
      if (!cancelled) timer = window.setTimeout(poll, activeRef.current ? 3000 : 15000);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, limit, tick]);
  return { ...state, refresh: () => setTick(value => value + 1) };
}

function readTasksLocation() {
  const params = new URLSearchParams(location.search);
  return {
    limit: params.get('taskLimit') === String(TASK_MORE_LIMIT) ? TASK_MORE_LIMIT : TASK_BASE_LIMIT,
    runId: params.get('run'),
  };
}

function useTasksLocation() {
  const [state, setState] = useState(readTasksLocation);
  useEffect(() => {
    const sync = () => setState(readTasksLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const write = (next: { limit?: number; runId?: string | null }, mode: 'push' | 'replace') => {
    const params = new URLSearchParams(location.search);
    const limit = next.limit ?? state.limit;
    const runId = next.runId === undefined ? state.runId : next.runId;
    if (limit === TASK_MORE_LIMIT) params.set('taskLimit', String(limit));
    else params.delete('taskLimit');
    if (runId) params.set('run', runId);
    else params.delete('run');
    const text = params.toString();
    const target = `${location.pathname}${text ? `?${text}` : ''}${location.hash}`;
    if (mode === 'push') history.pushState(null, '', target);
    else history.replaceState(null, '', target);
    setState(readTasksLocation());
  };
  return { ...state, write };
}

function orderRuns(runs: RunRecord[]): RunRecord[] {
  const time = (run: RunRecord) => Date.parse(run.createdAt) || 0;
  return [...runs].sort((a, b) => {
    const rank = Number(isActiveRun(b)) - Number(isActiveRun(a));
    return rank || time(b) - time(a) || b.id.localeCompare(a.id);
  });
}

function runDuration(run: RunRecord, now: number): string {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN;
  if (Number.isNaN(start)) return '—';
  const end = run.finishedAt ? Date.parse(run.finishedAt) : run.state === 'running' ? now : NaN;
  if (Number.isNaN(end)) return '—';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function primarySelection(run: RunRecord): string {
  const selection = run.selection as Record<
    string,
    { provider: ProviderKey; model: string } | undefined
  > | null;
  if (!selection) return '—';
  for (const key of ['evaluation', 'cv', 'coverLetter']) {
    const item = selection[key];
    if (item && providerLabels[item.provider]) {
      return `${providerLabels[item.provider]} / ${item.model}`;
    }
  }
  return '—';
}

const interruptedCopy =
  'Interrupted: the worker stopped, or the server could not observe it any more. Nothing was resumed.';

function RunLogFollow({ runId, active }: { runId: string; active: boolean }) {
  const [text, setText] = useState('');
  const [paused, setPaused] = useState(false);
  const [lagging, setLagging] = useState(false);
  const offsetRef = useRef(0);
  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    offsetRef.current = 0;
    setText('');
    setPaused(false);
  }, [runId]);
  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const pull = async () => {
      try {
        const result = await api.runLog(runId, offsetRef.current, controller.signal);
        if (cancelled) return;
        offsetRef.current = result.data.nextOffset;
        setLagging(false);
        if (result.data.text) setText(previous => (previous + result.data.text).slice(-20000));
      } catch {
        if (!cancelled) setLagging(true);
      }
      if (!cancelled && active) timer = window.setTimeout(pull, 2000);
    };
    void pull();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [runId, active, paused]);
  useEffect(() => {
    const pre = preRef.current;
    if (pre && !paused) pre.scrollTop = pre.scrollHeight;
  }, [text, paused]);
  return (
    <div className="log-follow">
      <div className="log-follow-head">
        <strong>Log</strong>
        {active && (
          <button className="quiet-button" onClick={() => setPaused(value => !value)}>
            {paused ? 'Continue following' : 'Pause'}
          </button>
        )}
        {paused && <span className="pane-meta">Paused. The log is not being read.</span>}
        {lagging && !paused && (
          <span className="pane-meta" role="status">
            {active ? 'Reconnecting...' : 'The log could not be read.'}
          </span>
        )}
      </div>
      <pre ref={preRef} className="doc-text log-tail" tabIndex={0} aria-label="Run log tail">
        {text || 'The log is empty so far.'}
      </pre>
    </div>
  );
}

function ScanReportSummary({ runId }: { runId: string }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok'; value: ScanReport } | { kind: 'error' }
  >({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    api.scanReport(runId, controller.signal).then(
      result => {
        if (!controller.signal.aborted) setState({ kind: 'ok', value: result.data });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [runId]);
  if (state.kind === 'loading') return <p className="pane-meta">Reading the scan report...</p>;
  if (state.kind === 'error')
    return <p className="missing-copy">The scan finished but its report could not be read.</p>;
  return (
    <div className="scan-report">
      <h4>Scan report{state.value.dryRun ? ' (dry run, nothing saved)' : ''}</h4>
      <dl className="report-summary">
        {summaryLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{state.value.summary[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const first = controls.item(0);
  const last = controls.item(controls.length - 1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function ScanAgainDialog({
  run,
  nonce,
  onClose,
  onStarted,
  onBusy,
}: {
  run: RunRecord;
  nonce: string;
  onClose: () => void;
  onStarted: () => void;
  onBusy: (runId: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const previous = (run.selection ?? {}) as { dryRun?: boolean; company?: string | null };
  const [dry, setDry] = useState(previous.dryRun === true);
  const [company, setCompany] = useState(previous.company ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.startScan(
        {
          action: 'scan',
          requestKey: `scan-${crypto.randomUUID()}`,
          dryRun: dry,
          ...(company.trim() ? { company: company.trim() } : {}),
        },
        nonce,
        new AbortController().signal,
      );
      onStarted();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'DISCOVERY_BUSY') {
        onBusy(activeRunId(failure));
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError('The local session is no longer valid, so nothing was started. Reload the page.');
      } else {
        setError(
          failure instanceof ApiFailure ? failure.message : 'The scan could not be started.',
        );
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      className="dialog action-dialog"
      ref={ref}
      aria-labelledby="scan-again-title"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={trapTab}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="scan-again-title">Start the portal scan again?</h2>
      <p className="pane-meta">
        This is a new run. It runs in the background. A dry run shows what a scan would find without
        saving anything.
      </p>
      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={dry}
          disabled={busy}
          onChange={event => setDry(event.target.checked)}
        />{' '}
        Dry run (save nothing)
      </label>
      <label className="scan-filter">
        Company filter (optional)
        <input
          type="text"
          value={company}
          maxLength={100}
          disabled={busy}
          placeholder="Leave empty to scan everything"
          onChange={event => setCompany(event.target.value)}
        />
      </label>
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting...' : 'Start'}
        </button>
        <button className="quiet-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

type AgainTarget =
  | { kind: 'job'; run: RunRecord; job: DetailJob }
  | { kind: 'publish'; run: RunRecord; job: DetailJob; hash: string; hasPdf: boolean }
  | { kind: 'scan'; run: RunRecord };

function TasksPage({
  monitor,
  limit,
  runId,
  write,
  dispatch,
}: {
  monitor: RunsMonitor;
  limit: number;
  runId: string | null;
  write: (next: { limit?: number; runId?: string | null }, mode: 'push' | 'replace') => void;
  dispatch: { nonce: string } | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<AgainTarget | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const runs = orderRuns(monitor.runs);
  const terminalCount = runs.filter(run => !isActiveRun(run)).length;
  const activeCount = runs.filter(isActiveRun).length;
  useEffect(() => {
    if (activeCount === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCount]);

  const startAgain = async (run: RunRecord) => {
    setNotice(null);
    if (run.action === 'scan') {
      setTarget({ kind: 'scan', run });
      return;
    }
    if (!run.jobId) {
      setNotice('This run has no job, so it cannot be started again from here.');
      return;
    }
    setChecking(run.id);
    try {
      const detail = await api.jobDetail(run.jobId, new AbortController().signal);
      const gate = detail.data.actions[run.action as 'evaluate' | 'cv' | 'letter' | 'publish'];
      if (!gate.enabled) {
        setNotice(`Start again is not available: ${gate.reason ?? 'the action is not available.'}`);
      } else if (run.action === 'publish') {
        const current = await api.letter(run.jobId, new AbortController().signal);
        if (current.data.editable)
          setTarget({
            kind: 'publish',
            run,
            job: detail.data.job,
            hash: current.data.contentHash,
            hasPdf: current.data.pdf !== null,
          });
        else
          setNotice(
            'Start again is not available: the cover letter cannot be published from here.',
          );
      } else {
        setTarget({ kind: 'job', run, job: detail.data.job });
      }
    } catch {
      setNotice('The job could not be read, so nothing was started.');
    } finally {
      setChecking(null);
    }
  };

  return (
    <section className="tasks-page" aria-label="Tasks">
      {monitor.reconnecting && (
        <p className="notice notice-warn" role="status">
          Reconnecting... The list below is the last one received.
        </p>
      )}
      {notice && (
        <div className="notice notice-ok" role="status">
          <p>{notice}</p>
        </div>
      )}
      {!monitor.loaded && !monitor.failed && (
        <p className="pane-meta" role="status">
          Reading runs...
        </p>
      )}
      {monitor.failed && (
        <div className="notice notice-error" role="alert">
          <div>
            <strong>The task list is unavailable.</strong>
            <p>The server could not return the list of runs. Nothing is shown in its place.</p>
          </div>
          <button onClick={monitor.refresh}>Retry</button>
        </div>
      )}
      {monitor.loaded && runs.length === 0 && (
        <p className="missing-copy">No runs have been recorded yet.</p>
      )}
      {runs.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Runs" tabIndex={0}>
          <table className="tasks-table">
            <caption className="visually-hidden">
              Runs, active first, then finished runs newest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Job</th>
                <th scope="col">State</th>
                <th scope="col" className="col-minor">
                  Step
                </th>
                <th scope="col" className="col-minor">
                  Provider / model
                </th>
                <th scope="col">Started</th>
                <th scope="col" className="col-minor">
                  Finished
                </th>
                <th scope="col" className="col-minor">
                  Duration
                </th>
                <th scope="col" className="col-minor">
                  Error
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const open = runId === run.id;
                const legacy = run.source === 'legacy';
                const detailId = `run-detail-${run.id}`;
                return [
                  <tr
                    key={run.id}
                    className="task-row"
                    data-state={run.state}
                    data-source={run.source}
                  >
                    <th scope="row">
                      <button
                        className="chevron-button task-toggle"
                        aria-expanded={open}
                        aria-controls={open ? detailId : undefined}
                        aria-label={`${open ? 'Hide' : 'Show'} details for the ${runActionLabel[run.action] ?? run.action} run`}
                        onClick={() => write({ runId: open ? null : run.id }, 'replace')}
                      >
                        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                      </button>
                      <span className="task-action">
                        {runActionLabel[run.action] ?? run.action}
                      </span>
                      {legacy && (
                        <span className="tui-badge" title="Recorded by the terminal dashboard">
                          Legacy
                        </span>
                      )}
                    </th>
                    <td>
                      {run.jobId ? (
                        <a className="in-page-link" href={`#/jobs/${run.jobId}`}>
                          #{run.jobId}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span
                        className={`run-badge run-${run.state}`}
                        title={run.errorCode ?? undefined}
                      >
                        {run.state}
                      </span>
                      {/* On narrow screens the minor columns fold into this cell, so a failed
                          run's reason is always readable without sideways scrolling. */}
                      <span className="task-extra">
                        {run.phase} · attempt {run.attempt}
                        {primarySelection(run) !== '—' ? ` · ${primarySelection(run)}` : ''}
                        {run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ''}
                        {runDuration(run, now) !== '—' ? ` · took ${runDuration(run, now)}` : ''}
                      </span>
                      {run.errorCode && (
                        <span className="task-extra task-extra-error" title={run.errorCode}>
                          {errorText(run.errorCode)}
                        </span>
                      )}
                      <RunLastLines run={run} />
                    </td>
                    <td className="col-minor">
                      {run.phase} · attempt {run.attempt}
                    </td>
                    <td className="col-minor">{primarySelection(run)}</td>
                    <td>{formatDateTime(run.startedAt ?? run.createdAt)}</td>
                    <td className="col-minor">
                      {run.finishedAt ? formatDateTime(run.finishedAt) : '—'}
                    </td>
                    <td className="col-minor">{runDuration(run, now)}</td>
                    <td className="col-minor" title={run.errorCode ?? undefined}>
                      {run.errorCode ? errorText(run.errorCode) : '—'}
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${run.id}-detail`} className="run-detail-row">
                      <td colSpan={9} id={detailId}>
                        <div className="run-detail">
                          <dl className="report-summary">
                            <div>
                              <dt>Run</dt>
                              <dd>{run.id}</dd>
                            </div>
                            <div>
                              <dt>Queued</dt>
                              <dd>{formatDateTime(run.createdAt)}</dd>
                            </div>
                            <div>
                              <dt>Exit code</dt>
                              <dd>{run.exitCode ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>Selection</dt>
                              <dd>{selectionText(run.selection) ?? '—'}</dd>
                            </div>
                          </dl>
                          {run.state === 'interrupted' && (
                            <p className="notice notice-warn">{interruptedCopy}</p>
                          )}
                          {run.state === 'failed' && (
                            <p className="notice notice-error">
                              {run.errorCode ? errorText(run.errorCode) : 'The run failed.'}
                              {run.errorCode && (
                                <span className="run-code"> Code: {run.errorCode}</span>
                              )}
                            </p>
                          )}
                          {run.jobId && (
                            <p>
                              <a className="in-page-link" href={`#/jobs/${run.jobId}`}>
                                Open the job workspace
                              </a>
                            </p>
                          )}
                          {legacy ? (
                            <p className="pane-meta">
                              Recorded by the terminal dashboard. No log or actions are available
                              here.
                            </p>
                          ) : (
                            <>
                              <RunLogFollow runId={run.id} active={isActiveRun(run)} />
                              {run.action === 'scan' && run.state === 'completed' && (
                                <ScanReportSummary runId={run.id} />
                              )}
                            </>
                          )}
                          {dispatch &&
                            !legacy &&
                            (run.state === 'failed' || run.state === 'interrupted') &&
                            startAgainActions.includes(run.action) && (
                              <div className="edit-actions">
                                <button
                                  className="primary-button"
                                  aria-disabled={checking === run.id}
                                  onClick={() => checking === null && void startAgain(run)}
                                >
                                  {checking === run.id ? 'Checking...' : 'Start again'}
                                </button>
                                <span className="pane-meta">
                                  Starts a new run; this one stays as it is.
                                </span>
                              </div>
                            )}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {monitor.loaded && limit === TASK_BASE_LIMIT && terminalCount >= TASK_BASE_LIMIT && (
        <button className="quiet-button" onClick={() => write({ limit: TASK_MORE_LIMIT }, 'push')}>
          Show more
        </button>
      )}
      {monitor.loaded && limit === TASK_MORE_LIMIT && terminalCount >= TASK_MORE_LIMIT && (
        <p className="pane-meta">Showing the latest {TASK_MORE_LIMIT} finished runs.</p>
      )}
      {dispatch && target?.kind === 'job' && (
        <ActionDialog
          action={actionButtons.find(item => item.key === target.run.action) ?? actionButtons[0]}
          job={target.job}
          nonce={dispatch.nonce}
          onClose={() => setTarget(null)}
          onStarted={() => {
            setTarget(null);
            setNotice('Started a new run. It appears at the top of the list.');
            monitor.refresh();
          }}
          onPrerequisite={(_actions, reason) => {
            setTarget(null);
            setNotice(`That action is no longer available: ${reason}`);
          }}
          onActive={() => {
            setTarget(null);
            setNotice('A run for this job is already active. It is listed above.');
            monitor.refresh();
          }}
        />
      )}
      {dispatch && target?.kind === 'publish' && (
        <PublishDialog
          job={target.job}
          hash={target.hash}
          hasPdf={target.hasPdf}
          nonce={dispatch.nonce}
          onClose={() => setTarget(null)}
          onStarted={() => {
            setTarget(null);
            setNotice('Started a new publish run. It appears at the top of the list.');
            monitor.refresh();
          }}
          onPrerequisite={(_actions, reason) => {
            setTarget(null);
            setNotice(`That action is no longer available: ${reason}`);
          }}
          onActive={() => {
            setTarget(null);
            setNotice('A run for this job is already active. It is listed above.');
            monitor.refresh();
          }}
          onConflict={() => {
            setTarget(null);
            setNotice(
              'The cover letter changed since this run, so nothing was published. Open the job workspace, review the saved text and publish from there.',
            );
          }}
        />
      )}
      {dispatch && target?.kind === 'scan' && (
        <ScanAgainDialog
          run={target.run}
          nonce={dispatch.nonce}
          onClose={() => setTarget(null)}
          onStarted={() => {
            setTarget(null);
            setNotice('Started a new scan. It appears at the top of the list.');
            monitor.refresh();
          }}
          onBusy={id => {
            setTarget(null);
            setNotice(
              id
                ? 'A scan or intake is already running. It is listed above.'
                : 'A scan or intake is already running. Try again when it finishes.',
            );
            monitor.refresh();
          }}
        />
      )}
    </section>
  );
}

function App() {
  const [page, jobId] = usePage();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [refreshKey, setRefreshKey] = useState(0);
  const connection = useConnection(refreshKey);
  const buildRel =
    connection.session.kind === 'success'
      ? buildRelation(connection.session.value.data.build)
      : 'same';
  const [dismissedBuild, setDismissedBuild] = useState<string | null>(null);
  const bannerMessage = buildMessage(buildRel);
  const staleBuild = bannerMessage !== null && dismissedBuild !== bannerMessage;
  const tasksLocation = useTasksLocation();
  // Write controls exist only when the server reports jobWrites; the nonce stays in memory.
  // The Providers entry follows the server: hidden only when the session says it is not offered.
  const providersAvailable =
    connection.session.kind === 'success'
      ? connection.session.value.data.capabilities.providerSettings
      : undefined;
  // The Cost entry shows only when the session reports the cost capability.
  const costAvailable =
    connection.session.kind === 'success'
      ? connection.session.value.data.capabilities.cost === true
      : undefined;
  const dispatch =
    connection.session.kind === 'success' &&
    connection.session.value.data.capabilities.taskDispatch === true
      ? { nonce: connection.session.value.data.nonce }
      : null;
  // One poll feeds both the Tasks page and the navigation count; it runs only when the page is
  // open or the server offers task dispatch.
  const monitor = useRunsMonitor(
    dispatch !== null || page === 'tasks',
    page === 'tasks' ? tasksLocation.limit : TASK_BASE_LIMIT,
  );
  const activeRunCount = dispatch
    ? monitor.runs.filter(run => isActiveRun(run) && run.source === 'browser').length
    : 0;
  // When the active-run count drops, runs have finished: Jobs and Overview re-read their data.
  const [dataEpoch, setDataEpoch] = useState(0);
  const previousActive = useRef(0);
  useEffect(() => {
    if (activeRunCount < previousActive.current) setDataEpoch(value => value + 1);
    previousActive.current = activeRunCount;
  }, [activeRunCount]);
  const sessionNonce =
    connection.session.kind === 'success' ? connection.session.value.data.nonce : null;
  const discoverCaps: DiscoverCaps | null =
    connection.session.kind === 'success'
      ? {
          nonce: connection.session.value.data.nonce,
          intake: connection.session.value.data.capabilities.intake === true,
          taskDispatch: connection.session.value.data.capabilities.taskDispatch === true,
        }
      : null;
  const writer =
    connection.session.kind === 'success' &&
    connection.session.value.data.capabilities.jobWrites === true
      ? { nonce: connection.session.value.data.nonce }
      : null;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('career-ops-theme', theme);
    } catch {
      /* Cosmetic preference only. */
    }
  }, [theme]);
  // Narrow screens show the main navigation as a scrolling strip: keep the current tab in view.
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.sidebar nav');
    const active = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const gap = 12;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.right > navBox.right - gap) nav.scrollLeft += box.right - navBox.right + gap;
    else if (box.left < navBox.left + gap) nav.scrollLeft -= navBox.left + gap - box.left;
  }, [page, jobId, providersAvailable, activeRunCount]);
  const [workspaceHeading, setWorkspaceHeading] = useState<{ title: string; lead: string } | null>(
    null,
  );
  const title = jobId
    ? (workspaceHeading?.title ?? 'Job workspace')
    : (pages.find(item => item.id === page)?.label ?? 'Overview');
  const pageLeads: Record<PageId, string> = {
    overview: 'Where your job search stands.',
    jobs: 'Search and browse the current database records.',
    discover: 'Add a job from a link, or scan your portals for new postings.',
    tasks: 'Background runs from this dashboard and the terminal one, as the server reports them.',
    cost: 'What the model calls used, as tokens or at public API prices.',
    providers: 'Which subscription and model each task uses.',
    service: 'Whether the local service and its database are working, and which build is running.',
  };
  const lead = jobId ? (workspaceHeading?.lead ?? 'Loading the job…') : pageLeads[page];
  const allLoading = Object.values(connection).some(state => state.kind === 'loading');
  const healthError = connection.health.kind === 'error' ? connection.health.error : undefined;
  const unavailable = healthError !== undefined;
  // Service status lives on its own page; the rest of the app mentions it only through the error
  // states and a dot on the Service entry while something is failing.
  const inWorkspace = page === 'jobs' && jobId !== null;
  const serviceFailing =
    unavailable || connection.ready.kind === 'error' || connection.session.kind === 'error';
  const serviceState = allLoading
    ? 'connecting'
    : unavailable
      ? 'unavailable'
      : serviceFailing
        ? 'limited'
        : 'ok';
  const chromeControls = (
    <button
      className="theme-button"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
    >
      <span aria-hidden="true">Aa</span>
      <span>Use {theme === 'light' ? 'dark' : 'light'} theme</span>
    </button>
  );
  return (
    <div
      className={`app-shell${inWorkspace ? ' is-workspace' : ''}${staleBuild ? ' has-banner' : ''}`}
      data-service={serviceState}
    >
      {staleBuild && (
        <div className="build-banner" role="alert">
          <span>{bannerMessage}</span>
          {buildRel === 'pageOlder' && (
            <button className="quiet-button" onClick={() => location.reload()}>
              Reload
            </button>
          )}
          <button className="quiet-button" onClick={() => setDismissedBuild(bannerMessage)}>
            Dismiss
          </button>
        </div>
      )}
      <a
        className="skip-link"
        href="#main"
        onClick={event => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Application sidebar">
        <a className="brand" href="#/overview">
          <span className="brand-mark" aria-hidden="true">
            co
          </span>
          <span>
            career-ops<small>Local workspace</small>
          </span>
        </a>
        <p className="nav-heading">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {pages
            .filter(item => item.id !== 'providers' || providersAvailable !== false)
            .filter(item => item.id !== 'cost' || costAvailable === true)
            .map(item => (
              <a
                key={item.id}
                href={`${location.search}#/${item.id}`}
                title={item.label}
                aria-current={page === item.id ? 'page' : undefined}
                onFocus={event => {
                  const link = event.currentTarget;
                  const nav = link.parentElement;
                  if (!nav || nav.scrollWidth <= nav.clientWidth) return;
                  const keepFocusedLinkVisible = () => {
                    if (!link.isConnected || document.activeElement !== link) return;
                    const navBounds = nav.getBoundingClientRect();
                    const linkBounds = link.getBoundingClientRect();
                    const focusClearance = 7;
                    if (linkBounds.left < navBounds.left + focusClearance) {
                      nav.scrollLeft -= navBounds.left + focusClearance - linkBounds.left;
                    } else if (linkBounds.right > navBounds.right - focusClearance) {
                      nav.scrollLeft += linkBounds.right - navBounds.right + focusClearance;
                    }
                  };
                  window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(keepFocusedLinkVisible);
                  });
                }}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.id === 'service' && serviceFailing && (
                  <span className="nav-dot" role="img" aria-label="Needs attention" />
                )}
                {item.id === 'tasks' && activeRunCount > 0 && (
                  <span className="nav-count">
                    <span aria-hidden="true">{activeRunCount}</span>
                    <span className="visually-hidden">
                      {' '}
                      ({activeRunCount} active {activeRunCount === 1 ? 'run' : 'runs'})
                    </span>
                  </span>
                )}
              </a>
            ))}
        </nav>
        <div className="sidebar-foot">
          <span className="local-pip" /> Local workspace<p>Thoughtful work, at your pace.</p>
        </div>
      </aside>
      <div className="main-shell">
        {!inWorkspace && (
          <header className="topbar">
            <p>
              Workspace <span aria-hidden="true">/</span> <strong>{title}</strong>
            </p>
            <div className="top-actions">
              <button
                className="theme-button"
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
              >
                <span aria-hidden="true">Aa</span>
                <span>Use {theme === 'light' ? 'dark' : 'light'} theme</span>
              </button>
            </div>
          </header>
        )}
        <main id="main" tabIndex={-1} data-page={page}>
          {!inWorkspace && page !== 'jobs' && (
            <div className="page-heading">
              <div>
                <p className="eyebrow">CAREER-OPS / WORKSPACE</p>
                <h1>{title}</h1>
                <p className="lead">{lead}</p>
              </div>
            </div>
          )}
          {healthError && (
            <div className="notice notice-error" role="alert">
              <div>
                <strong>
                  {healthError.network
                    ? 'Could not connect to the local service.'
                    : 'The local health check failed.'}
                </strong>
                <p>{healthError.message} Check the local service, then retry.</p>
              </div>
              <button onClick={() => setRefreshKey(value => value + 1)}>Retry connection</button>
            </div>
          )}
          {page === 'overview' ? (
            <OverviewPage refreshKey={dataEpoch} />
          ) : page === 'cost' && costAvailable !== true ? (
            <section className="capability-card">
              <div>
                <span className="card-kicker">CURRENT AVAILABILITY</span>
                <h2>Cost is unavailable</h2>
                <p>
                  {costAvailable === undefined
                    ? 'Checking what this server offers…'
                    : 'This server does not offer usage tracking.'}
                </p>
              </div>
              <span className="not-enabled">Unavailable</span>
            </section>
          ) : page === 'cost' ? (
            <CostPage api={api} />
          ) : page === 'providers' && providersAvailable === false ? (
            <section className="capability-card">
              <div>
                <span className="card-kicker">CURRENT AVAILABILITY</span>
                <h2>Providers is unavailable</h2>
                <p>This server does not offer provider settings.</p>
              </div>
              <span className="not-enabled">Unavailable</span>
            </section>
          ) : page === 'providers' ? (
            <ProvidersPage nonce={sessionNonce} />
          ) : page === 'service' ? (
            <ServicePage
              connection={connection}
              loading={allLoading}
              onRefresh={() => setRefreshKey(value => value + 1)}
            />
          ) : page === 'tasks' ? (
            <TasksPage
              monitor={monitor}
              limit={tasksLocation.limit}
              runId={tasksLocation.runId}
              write={tasksLocation.write}
              dispatch={dispatch}
            />
          ) : page === 'discover' ? (
            <DiscoverPage caps={discoverCaps} />
          ) : page === 'jobs' ? (
            jobId ? (
              <WorkspacePage
                id={jobId}
                key={jobId}
                writer={writer}
                dispatch={dispatch}
                onHeading={setWorkspaceHeading}
                chrome={chromeControls}
              />
            ) : (
              <JobsPage
                refreshKey={dataEpoch}
                intake={discoverCaps?.intake ? { nonce: discoverCaps.nonce } : null}
                writer={writer}
                dispatch={dispatch}
              />
            )
          ) : (
            <section className="capability-card">
              <div>
                <span className="card-kicker">CURRENT AVAILABILITY</span>
                <h2>{title} is unavailable</h2>
                <p>This area is not available in the current dashboard.</p>
              </div>
              <span className="not-enabled">Unavailable</span>
            </section>
          )}
        </main>
        {!inWorkspace && (
          <footer>
            <span>career-ops</span>
            <span>Local browser workspace</span>
          </footer>
        )}
      </div>
    </div>
  );
}

export default App;
