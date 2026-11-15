import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ApiFailure,
  type DetailJob,
  type JobActionKey,
  type JobActions,
  type RunRecord,
} from '../../api';
import { api } from '../../lib/client';
import { jobRunBody } from '../../components/QuickMoves';
import type { DetailData } from '../../lib/materials';
import { actionButtons } from '../../lib/jobActions';
import { isActiveRun } from '../../lib/runs';
import { RunCard } from '../../components/RunCard';
import { ActionDialog } from '../../components/ActionDialog';
import { PublishDialog } from '../../components/PublishDialog';
import { isObject } from '../../lib/errors';

export function JobActionsPanel({
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
