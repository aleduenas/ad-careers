import { useEffect, useRef, useState } from 'react';
import { buildMessage, buildRelation } from './api';
import { CostPage } from './pages/cost/CostPage';
import { pages, type PageId, usePage } from './lib/navigation';
import { type Theme, initialTheme } from './lib/theme';
import { api } from './lib/client';
import { JobsPage } from './pages/jobs/JobsPage';
import { isActiveRun, TASK_BASE_LIMIT, useRunsMonitor } from './lib/runs';
import { WorkspacePage } from './pages/workspace/WorkspacePage';
import { OverviewPage } from './pages/overview/OverviewPage';
import { type DiscoverCaps, DiscoverPage } from './pages/discover/DiscoverPage';
import { ProvidersPage } from './pages/providers/ProvidersPage';
import { useConnection } from './lib/connection';
import { ServicePage } from './pages/service/ServicePage';
import { useTasksLocation, TasksPage } from './pages/tasks/TasksPage';
import { PageBoundary } from './components/PageBoundary';
import './styles.css';

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
          <PageBoundary name={title} resetKey={`${page}/${jobId ?? ''}`}>
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
          </PageBoundary>
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
