import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type BatchResult, type BatchSkip, type JobItem } from '../../api';
import { api } from '../../lib/client';
import { BatchDialog } from './BatchDialog';
import type { BatchIntent, BatchOutcome } from './BatchDialog';
import { canQuickDiscard } from '../../components/QuickMoves';
import {
  BatchDiscardDialog,
  DiscardResult,
  type DiscardOutcome,
  type DiscardTarget,
} from './BatchDiscard';

const NEXT_DEFAULT = 10;
const POLL_MS = 4000;

/** What the status line under the bar reports about the latest start. */
interface BatchStatus {
  groupId: string | null;
  started: number;
  /** Runs of the group still waiting; null until known. */
  waiting: number | null;
  skipped: BatchSkip[];
  replayed: boolean;
  cancelled: number | null;
  cancelError: string | null;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** A row can be evaluated when runs can be dispatched and it is Pending. */
export const canEvaluateRow = (job: { status: string }, dispatch: unknown) =>
  Boolean(dispatch) && job.status === 'Pending';
/** A row can be discarded when writes are offered and the single-row controls offer Discard. */
export const canDiscardRow = (job: { status: string }, writer: unknown) =>
  Boolean(writer) && canQuickDiscard(job.status);

export function BatchBar({
  dispatch,
  writer,
  items,
  selected,
  onSelectedChange,
  onDiscarded,
}: {
  dispatch: { nonce: string } | null;
  writer: { nonce: string } | null;
  /** Rows on the current page. Rows that can be evaluated or discarded can be selected. */
  items: JobItem[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Called after a batch discard so the list can be read again. */
  onDiscarded: () => void;
}) {
  const [intent, setIntent] = useState<BatchIntent | null>(null);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const allBox = useRef<HTMLInputElement | null>(null);
  const needsFocus = useRef(false);
  const [discardTargets, setDiscardTargets] = useState<DiscardTarget[] | null>(null);
  const [discardOutcome, setDiscardOutcome] = useState<DiscardOutcome | null>(null);
  const discardRef = useRef<HTMLDivElement | null>(null);

  const eligible = items.filter(job => canEvaluateRow(job, dispatch) || canDiscardRow(job, writer));
  const picked = eligible.filter(job => selected.has(job.id));
  const evaluable = picked.filter(job => canEvaluateRow(job, dispatch));
  const discardable = picked.filter(job => canDiscardRow(job, writer));
  const everyPicked = eligible.length > 0 && picked.length === eligible.length;
  useEffect(() => {
    if (allBox.current)
      allBox.current.indeterminate = picked.length > 0 && picked.length < eligible.length;
  }, [picked.length, eligible.length]);

  const describe = (jobId: string) => {
    const job = items.find(item => item.id === jobId);
    return job ? `${job.company || 'Company missing'} – ${job.role || 'Role missing'}` : '';
  };

  const outcome = (result: BatchOutcome) => {
    const sent: string[] = intent?.kind === 'selected' ? intent.jobIds : [];
    setIntent(null);
    if (sent.length) onSelectedChange(new Set([...selected].filter(id => !sent.includes(id))));
    if (result.kind === 'none') {
      setStatus({
        groupId: null,
        started: 0,
        waiting: 0,
        skipped: result.skipped,
        replayed: false,
        cancelled: null,
        cancelError: null,
      });
    } else {
      const data: BatchResult = result.result;
      setStatus({
        groupId: data.groupId,
        started: data.runs.length,
        waiting: data.runs.filter(run => run.state === 'queued').length,
        skipped: data.skipped,
        replayed: data.replayed,
        cancelled: null,
        cancelError: null,
      });
    }
    needsFocus.current = true;
  };

  // The dialog hands focus back to the button that opened it; when that button is now disabled
  // (the selection was cleared) the status line takes it so the keyboard user keeps their place.
  useEffect(() => {
    if (!needsFocus.current) return;
    needsFocus.current = false;
    const active = document.activeElement as HTMLButtonElement | null;
    if (!active || active === document.body || active.disabled) statusRef.current?.focus();
  }, [status]);

  // While runs of the group still wait, ask the server how many; stop at zero.
  const groupId = status?.groupId ?? null;
  const waiting = status?.waiting ?? 0;
  useEffect(() => {
    if (!groupId || waiting === 0) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = () => {
      api.runs(controller.signal).then(
        result => {
          if (controller.signal.aborted) return;
          const count = result.data.runs.filter(
            run => run.groupId === groupId && run.state === 'queued',
          ).length;
          setStatus(previous =>
            previous && previous.groupId === groupId ? { ...previous, waiting: count } : previous,
          );
          if (count > 0) timer = window.setTimeout(poll, POLL_MS);
        },
        () => {
          if (!controller.signal.aborted) timer = window.setTimeout(poll, POLL_MS * 2);
        },
      );
    };
    timer = window.setTimeout(poll, POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [groupId, waiting > 0]);

  const cancelWaiting = async () => {
    if (!status?.groupId || cancelling) return;
    setCancelling(true);
    setStatus({ ...status, cancelError: null });
    try {
      const result = await api.cancelQueuedRuns(
        status.groupId,
        dispatch?.nonce ?? '',
        new AbortController().signal,
      );
      setStatus(previous =>
        previous
          ? { ...previous, waiting: 0, cancelled: result.data.cancelled, cancelError: null }
          : previous,
      );
    } catch (failure) {
      const text =
        failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED'
          ? 'The local session is no longer valid, so nothing was cancelled. Reload the page and try again.'
          : failure instanceof ApiFailure
            ? failure.message
            : 'The waiting evaluations could not be cancelled.';
      setStatus(previous => (previous ? { ...previous, cancelError: text } : previous));
    } finally {
      setCancelling(false);
    }
  };

  const none = status && status.started === 0;

  return (
    <>
      <section className="batch-bar" aria-label="Work on several jobs">
        <label className="batch-select-all">
          <input
            ref={allBox}
            type="checkbox"
            checked={everyPicked}
            disabled={eligible.length === 0}
            onChange={() =>
              onSelectedChange(everyPicked ? new Set() : new Set(eligible.map(job => job.id)))
            }
          />
          <span>
            Select all on this page
            <small> ({eligible.length})</small>
          </span>
        </label>
        <div className="batch-buttons">
          {dispatch && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={evaluable.length === 0}
                onClick={() =>
                  setIntent({
                    kind: 'selected',
                    jobIds: evaluable.map(job => job.id) as [string, ...string[]],
                  })
                }
              >
                Evaluate selected ({evaluable.length})
              </button>
              <button
                type="button"
                onClick={() => setIntent({ kind: 'next', count: NEXT_DEFAULT })}
              >
                Evaluate next {NEXT_DEFAULT}
              </button>
              <button type="button" onClick={() => setIntent({ kind: 'custom' })}>
                Evaluate next…
              </button>
            </>
          )}
          {writer && (
            <button
              type="button"
              className="quick-move-reject"
              disabled={discardable.length === 0}
              onClick={() =>
                setDiscardTargets(
                  discardable.map(job => ({
                    id: job.id,
                    revision: job.revision,
                    label: `${job.company || 'Company missing'} – ${job.role || 'Role missing'}`,
                  })),
                )
              }
            >
              Discard selected ({discardable.length})
            </button>
          )}
        </div>
      </section>
      {discardTargets && writer && (
        <BatchDiscardDialog
          targets={discardTargets}
          nonce={writer.nonce}
          onClose={() => setDiscardTargets(null)}
          onDone={result => {
            const gone = new Set(discardTargets.map(target => target.id));
            setDiscardTargets(null);
            onSelectedChange(new Set([...selected].filter(id => !gone.has(id))));
            setDiscardOutcome(result);
            onDiscarded();
            window.setTimeout(() => discardRef.current?.focus(), 0);
          }}
        />
      )}
      {discardOutcome && (
        <DiscardResult
          outcome={discardOutcome}
          innerRef={discardRef}
          onDismiss={() => setDiscardOutcome(null)}
        />
      )}
      {intent && dispatch && (
        <BatchDialog
          intent={intent}
          nonce={dispatch.nonce}
          onClose={() => setIntent(null)}
          onOutcome={outcome}
        />
      )}
      {status && (
        <div
          className={`notice batch-status ${none ? 'notice-warn' : ''}`}
          role="status"
          tabIndex={-1}
          ref={statusRef}
        >
          <div className="batch-status-body">
            {none ? (
              <p>
                <strong>Nothing was started.</strong> No job in this request can be evaluated right
                now.
              </p>
            ) : (
              <>
                <p>
                  <strong>
                    {status.replayed ? 'Already started: ' : 'Started '}
                    {status.started} {plural(status.started, 'evaluation', 'evaluations')}.
                  </strong>{' '}
                  {status.waiting !== null && status.waiting > 0
                    ? `${status.waiting} ${status.waiting === 1 ? 'is waiting its turn' : 'are waiting their turn'}. `
                    : ''}
                  Follow {plural(status.started, 'it', 'them')} on the{' '}
                  <a href={`${location.pathname}#/tasks`}>Tasks page</a>.
                </p>
                {status.cancelled !== null && (
                  <p>
                    Cancelled {status.cancelled} waiting{' '}
                    {plural(status.cancelled, 'evaluation', 'evaluations')}. Running ones continue.
                  </p>
                )}
              </>
            )}
            {status.cancelError && <p className="field-error">{status.cancelError}</p>}
            {status.skipped.length > 0 && (
              <div className="batch-skipped">
                <p>
                  Skipped {status.skipped.length} {plural(status.skipped.length, 'job', 'jobs')}:
                </p>
                <ul>
                  {status.skipped.map(item => (
                    <li key={item.jobId}>
                      <a href={`${location.search}#/jobs/${item.jobId}`}>Job {item.jobId}</a>
                      {describe(item.jobId) ? ` (${describe(item.jobId)})` : ''}: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="batch-status-actions">
            {status.waiting !== null && status.waiting > 0 && (
              <button type="button" disabled={cancelling} onClick={() => void cancelWaiting()}>
                {cancelling ? 'Cancelling…' : 'Cancel waiting'}
              </button>
            )}
            <button type="button" className="quiet-button" onClick={() => setStatus(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
