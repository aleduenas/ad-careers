import { useEffect, useState } from 'react';
import type { DetailJob, RunRecord } from '../../api';
import { api } from '../../lib/client';
import { formatDateTime } from '../../lib/format';
import { actionButtons } from '../../lib/jobActions';
import {
  errorText,
  needsLocationDecision,
  stateClass,
  stateText,
  runActionLabel,
  isActiveRun,
  selectionText,
  TASK_BASE_LIMIT,
  TASK_MORE_LIMIT,
  type RunsMonitor,
  orderRuns,
  runDuration,
  primarySelection,
  interruptedCopy,
} from '../../lib/runs';
import { RunLastLines } from '../../components/RunCard';
import { ActionDialog } from '../../components/ActionDialog';
import { PublishDialog } from '../../components/PublishDialog';
import { RunLogFollow, ScanReportSummary } from './RunViews';
import { ScanAgainDialog } from './ScanAgainDialog';

const startAgainActions = ['evaluate', 'cv', 'letter', 'scan', 'publish'];

function readTasksLocation() {
  const params = new URLSearchParams(location.search);
  return {
    limit: params.get('taskLimit') === String(TASK_MORE_LIMIT) ? TASK_MORE_LIMIT : TASK_BASE_LIMIT,
    runId: params.get('run'),
  };
}

export function useTasksLocation() {
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

type AgainTarget =
  | { kind: 'job'; run: RunRecord; job: DetailJob }
  | { kind: 'publish'; run: RunRecord; job: DetailJob; hash: string; hasPdf: boolean }
  | { kind: 'scan'; run: RunRecord };

export function TasksPage({
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
                      <span className={stateClass(run)} title={run.errorCode ?? undefined}>
                        {stateText(run)}
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
                        <span
                          className={`task-extra task-extra-error${needsLocationDecision(run) ? ' run-review-text' : ''}`}
                          title={run.errorCode}
                        >
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
                            <p
                              className={
                                needsLocationDecision(run)
                                  ? 'notice notice-warn'
                                  : 'notice notice-error'
                              }
                            >
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
