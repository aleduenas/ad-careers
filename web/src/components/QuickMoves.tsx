import { useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  conflictCode,
  type DetailJob,
  type JobActionKey,
  type JobActions,
} from '../api';
import { api } from '../lib/client';
import { writeErrorText, fieldErrors, isObject } from '../lib/errors';
import { DiscardDialog } from './DiscardDialog';
import { NO_REASON } from '../lib/discard';

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

/** Whether the quick pair offers Discard for this status (Pending and Evaluated). */
export const canQuickDiscard = (status: string) => quickRed[status] === 'Discard';

/** A single click waits this long for a second one before it opens the popout. */
const DOUBLE_CLICK_MS = 250;

const REJECT_CONFIRM_MS = 5000;

/** What Evaluate does from the pair: start the run, or explain why it cannot. */

interface QuickEvaluate {
  /** Reason the button is disabled, or null when it can start. */
  disabledReason: string | null;
  /** Starts the run; may throw an Error whose message is shown under the pair. */
  start: () => Promise<void> | void;
}

/** The run request the primary Evaluate button sends: the server resolves the saved settings. */

export function jobRunBody(key: JobActionKey, jobId: string) {
  return { action: key, jobId, requestKey: `job-${key}-${jobId}-${crypto.randomUUID()}` } as const;
}

/** Start an evaluation with the saved per-function settings (row Evaluate; refusals become text). */

export async function startEvaluation(jobId: string, nonce: string): Promise<void> {
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

export function QuickMoves({
  job,
  nonce,
  onMoved,
  onConflict,
  onNotice,
  evaluate,
  fastDiscard: allowFastDiscard = false,
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
  /** Jobs list rows only: a double click on Discard discards at once, without the popout. */
  fastDiscard?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const setNotice = (message: string | null) =>
    onNotice ? onNotice(message) : setLocalNotice(message);
  const notice = onNotice ? null : localNotice;
  const timer = useRef<number | undefined>(undefined);
  const discardClick = useRef<number | undefined>(undefined);
  const fastDiscard = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(discardClick.current);
    },
    [],
  );
  useEffect(() => {
    window.clearTimeout(timer.current);
    setConfirming(false);
    setDiscarding(false);
    setStarted(false);
  }, [job.status, job.revision]);
  const next = quickNext[job.status];
  const showEvaluate = job.status === 'Pending' && Boolean(evaluate);
  const red = quickRed[job.status];
  if (!next && !showEvaluate && !red) return null;

  const move = async (status: QuickMove, reason = ''): Promise<boolean> => {
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
      return true;
    } catch (failure) {
      if (conflictCode(failure) === 'REVISION_CONFLICT') {
        setDiscarding(false);
        setNotice('This job was changed elsewhere. Its current status is shown.');
        await onConflict();
      } else if (status === 'Discarded' && discarding) {
        // The popout stays open with the reason the owner typed and says why it was refused.
        setDiscardError(fieldErrors(failure).reason ?? writeErrorText(failure));
      } else {
        setNotice(writeErrorText(failure));
      }
      return false;
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
            className="quick-move quick-move-reject"
            disabled={busy}
            aria-label="Discard"
            title={
              allowFastDiscard
                ? 'Click for reasons, double-click to discard now'
                : 'Discard this job'
            }
            onClick={event => {
              window.clearTimeout(discardClick.current);
              // The second click of a double click is handled by onDoubleClick.
              if (event.detail >= 2) return;
              const open = () => {
                setNotice(null);
                setDiscardError(null);
                setDiscarding(true);
              };
              // Keyboard activation (no click count) opens the popout at once, never the fast path.
              if (event.detail === 0 || !allowFastDiscard) open();
              else discardClick.current = window.setTimeout(open, DOUBLE_CLICK_MS);
            }}
            onDoubleClick={() => {
              if (!allowFastDiscard) return;
              window.clearTimeout(discardClick.current);
              if (busy || fastDiscard.current) return;
              fastDiscard.current = true;
              setNotice(null);
              void move('Discarded', NO_REASON).finally(() => {
                fastDiscard.current = false;
              });
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
      {discarding && (
        <DiscardDialog
          title="Discard this job?"
          description="Nothing else about the job changes."
          busy={busy}
          error={discardError}
          onClose={() => setDiscarding(false)}
          onConfirm={reason => void move('Discarded', reason)}
        />
      )}
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
