import { useEffect, useRef, useState } from 'react';
import { ApiFailure, createApi, type EndpointState } from './api';
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
  { id: 'providers', label: 'Providers', icon: 'P' },
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

function scoreText(score: number | null, pending = false) {
  if (pending || score === null) return '—';
  return score.toFixed(1);
}

function JobsPage() {
  const [locationState, updateLocation] = useJobsLocation();
  const { query, cursor } = locationState;
  const [request, setRequest] = useState<EndpointState<JobsResponse>>({ kind: 'loading' });
  const [cursorNotice, setCursorNotice] = useState(false);
  const [retry, setRetry] = useState(0);
  const searchHistoryStarted = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++sequence.current;
    setRequest({ kind: 'loading' });
    void api.jobs(query, cursor, controller.signal).then(
      value => {
        if (!controller.signal.aborted && requestId === sequence.current)
          setRequest({ kind: 'success', value });
      },
      error => {
        if (controller.signal.aborted || requestId !== sequence.current) return;
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
    cursor,
    retry,
  ]);

  const changeQuery = (patch: Partial<JobsQuery>, mode: 'push' | 'replace' = 'push') => {
    updateLocation({ ...query, ...patch }, null, mode);
    setCursorNotice(false);
  };
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
            <th scope="col">Materials</th>
            <th scope="col">Discard reason</th>
          </tr>
        </thead>
        <tbody>
          {items.map(job => {
            const pending = job.status === 'Pending';
            const comp = pending
              ? 'Not evaluated'
              : (job.compensation.text ??
                (job.compensation.state === 'missing'
                  ? 'Not available'
                  : job.compensation.state === 'invalid'
                    ? 'Unavailable'
                    : 'Not assessed'));
            const salary = job.salary
              ? [job.salary.min, job.salary.max].filter(Boolean).join(' – ')
              : null;
            return (
              <tr key={job.id}>
                <th scope="row" className="job-id">
                  {job.id}
                </th>
                <td className="job-name">
                  <strong>{job.company || 'Company missing'}</strong>
                  <span>{job.role || 'Role missing'}</span>
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
                <td>
                  <div className="material-badges">
                    {job.materials.cv && <span className="material-badge">CV</span>}
                    {job.materials.letter && <span className="material-badge">Letter</span>}
                    {!job.materials.cv && !job.materials.letter && (
                      <span aria-label="No verified materials">—</span>
                    )}
                  </div>
                </td>
                <td>
                  {job.status === 'Discarded' ? job.discardReason || 'No reason recorded' : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <section className="section-heading jobs-toolbar">
        <div>
          <h2>Jobs</h2>
          <p>Search and browse the current database records.</p>
        </div>
        <label className="search-control">
          Search jobs
          <input
            type="search"
            value={query.q}
            placeholder="ID, company, role or notes"
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
      </section>
      <section className="jobs-controls" aria-label="Job list controls">
        <label>
          Filter
          <select
            value={query.filter}
            onChange={event => changeQuery({ filter: event.target.value as JobsQuery['filter'] })}
          >
            <option value="all">All non-pending</option>
            <option value="pending">Pending</option>
            <option value="evaluated">Evaluated</option>
            <option value="applied">Applied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="top">Top score ≥ 4</option>
            <option value="rejected">Rejected</option>
            <option value="discarded">Discarded</option>
            <option value="ghosted">Ghosted</option>
          </select>
        </label>
        <label>
          Sort by
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
        <label>
          Direction
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
        <label>
          Rows per page
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
        <label className="checkbox-control">
          <input
            type="checkbox"
            checked={query.grouped}
            onChange={event => changeQuery({ grouped: event.target.checked })}
          />{' '}
          Group by status
        </label>
      </section>
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
          <p className="results-summary" aria-live="polite">
            {response.totalCount === 0
              ? 'No matching jobs'
              : `Page · ${response.items.length} shown · ${response.totalCount} matching jobs`}
          </p>
          {response.items.length === 0 ? (
            <section className="empty-state">
              <h3>
                {response.totalCount === 0 ? 'No jobs match these filters' : 'No jobs on this page'}
              </h3>
              <p>Try another search or filter.</p>
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
          <nav className="pagination" aria-label="Jobs pages">
            <button
              className="quiet-button"
              disabled={!response.previousCursor}
              onClick={() => updateLocation(query, response.previousCursor)}
            >
              Previous page
            </button>
            <span>{response.totalCount} matching jobs</span>
            <button
              className="quiet-button"
              disabled={!response.nextCursor}
              onClick={() => updateLocation(query, response.nextCursor)}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </>
  );
}

function OverviewPage() {
  const [state, setState] = useState<EndpointState<OverviewResponse>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
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
  }, [retry]);
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
                    {step.count} · {step.percent}%
                  </span>
                </div>
                <progress
                  max="100"
                  value={step.percent}
                  aria-label={`${step.label}: ${step.count}, ${step.percent}%`}
                />
              </div>
            ))}
          </div>
          <div className="rate-row">
            <span>
              Response rate <strong>{progress.responseRate}%</strong>
            </span>
            <span>
              Interview rate <strong>{progress.interviewRate}%</strong>
            </span>
            <span>
              Offer rate <strong>{progress.offerRate}%</strong>
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
            {progress.scoreBuckets.map(bucket => (
              <div key={bucket.label}>
                <span>{bucket.label}</span>
                <strong>{bucket.count}</strong>
              </div>
            ))}
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
                <div key={week.week}>
                  <span>{week.week}</span>
                  <strong>{week.count}</strong>
                </div>
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

function usePage(): [PageId, (page: PageId) => void] {
  const parse = (): PageId => {
    const route = location.hash.slice(1).replace(/^\//, '');
    return pages.some(page => page.id === route) ? (route as PageId) : 'overview';
  };
  const [page, setPage] = useState(parse);
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
        <small>{state.error.code}</small>
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

function App() {
  const [page] = usePage();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const connection = useConnection(refreshKey);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('career-ops-theme', theme);
    } catch {
      /* Cosmetic preference only. */
    }
  }, [theme]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailsOpen && !dialog.open) dialog.showModal();
    if (!detailsOpen && dialog.open) dialog.close();
  }, [detailsOpen]);
  const title = pages.find(item => item.id === page)?.label ?? 'Overview';
  const allLoading = Object.values(connection).some(state => state.kind === 'loading');
  const healthError = connection.health.kind === 'error' ? connection.health.error : undefined;
  const unavailable = healthError !== undefined;
  return (
    <div className="app-shell">
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
          {pages.map(item => (
            <a
              key={item.id}
              href={`${location.search}#/${item.id}`}
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
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="local-pip" /> Local workspace<p>Thoughtful work, at your pace.</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <p>
            Workspace <span aria-hidden="true">/</span> <strong>{title}</strong>
          </p>
          <div className="top-actions">
            <button className="quiet-button" onClick={() => setDetailsOpen(true)}>
              Connection details
            </button>
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
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">CAREER-OPS / WORKSPACE</p>
              <h1>{title}</h1>
              <p className="lead">Your local job search workspace.</p>
            </div>
            <span className={`connection-pill ${unavailable ? 'is-error' : ''}`}>
              <span className="status-dot" />
              {allLoading
                ? 'Connecting'
                : unavailable
                  ? healthError.network
                    ? 'Service unavailable'
                    : 'Health check failed'
                  : connection.ready.kind === 'error'
                    ? 'Limited readiness'
                    : 'Local service'}
            </span>
          </div>
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
            <OverviewPage />
          ) : page === 'jobs' ? (
            <JobsPage />
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
          <section className="connection-summary" aria-label="Service status">
            <div className="section-heading">
              <div>
                <h2>Service status</h2>
                <p>Health, readiness and session checks.</p>
              </div>
              <button
                className="quiet-button"
                onClick={() => setRefreshKey(value => value + 1)}
                disabled={allLoading}
              >
                Refresh status
              </button>
            </div>
            <div className="status-grid">
              <EndpointCard title="Application health" state={connection.health} />
              <EndpointCard title="Database readiness" state={connection.ready} />
              <EndpointCard title="Dashboard session" state={connection.session} />
            </div>
            {connection.health.kind === 'success' && connection.ready.kind === 'error' && (
              <div className="notice notice-warn" role="status">
                <div>
                  <strong>Database readiness is unavailable.</strong>
                  <p>
                    {connection.ready.error.message} Check your database connection, then retry.
                  </p>
                </div>
                <button onClick={() => setRefreshKey(value => value + 1)} disabled={allLoading}>
                  Retry readiness
                </button>
              </div>
            )}
          </section>
        </main>
        <footer>
          <span>career-ops</span>
          <span>Local browser workspace</span>
        </footer>
      </div>
      <dialog
        className="dialog"
        ref={dialogRef}
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
        onCancel={() => setDetailsOpen(false)}
        onClose={() => setDetailsOpen(false)}
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
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const clickedOutside =
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom;
          if (clickedOutside) setDetailsOpen(false);
        }}
      >
        <button
          className="dialog-close"
          aria-label="Close connection details"
          onClick={() => setDetailsOpen(false)}
        >
          x
        </button>
        <p className="eyebrow">LOCAL CONNECTION</p>
        <h2 id="dialog-title">Connection details</h2>
        <p className="dialog-copy" id="dialog-description">
          The dashboard checks its service, database readiness and browser session independently.
        </p>
        <dl>
          <div>
            <dt>Application health</dt>
            <dd>
              {connection.health.kind === 'success'
                ? 'Available'
                : connection.health.kind === 'error'
                  ? connection.health.error.code
                  : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Database readiness</dt>
            <dd>
              {connection.ready.kind === 'success'
                ? 'Ready'
                : connection.ready.kind === 'error'
                  ? connection.ready.error.code
                  : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Job browsing</dt>
            <dd>
              {connection.session.kind === 'success'
                ? connection.session.value.data.capabilities.jobReads
                  ? 'Available'
                  : 'Unavailable'
                : connection.session.kind === 'error'
                  ? 'Unknown'
                  : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Workflow actions</dt>
            <dd>Unavailable</dd>
          </div>
        </dl>
        <div className="dialog-actions">
          <button className="quiet-button" onClick={() => setDetailsOpen(false)}>
            Close
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setDetailsOpen(false);
              setRefreshKey(value => value + 1);
            }}
          >
            Refresh checks
          </button>
        </div>
      </dialog>
    </div>
  );
}

export default App;
