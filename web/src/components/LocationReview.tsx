import { useEffect, useRef, useState } from 'react';
import { ApiFailure, conflictCode, type RunRecord } from '../api';
import { api } from '../lib/client';
import { useCapabilities } from '../lib/capabilities';
import { isObject } from '../lib/errors';
import { needsLocationDecision } from '../lib/runs';
import { DiscardDialog } from './DiscardDialog';

const FALLBACK =
  'The location gate could not tell whether this job is open to you. Open the log for its reason.';

function startFailureText(failure: unknown): string {
  if (failure instanceof ApiFailure) {
    if (failure.code === 'RUN_ACTIVE') return 'An evaluation is already running for this job.';
    if (failure.code === 'LOCAL_REQUEST_REJECTED')
      return 'The local session is no longer valid, so nothing was started. Reload the page and try again.';
    if (failure.code === 'PREREQUISITE_FAILED') {
      const actions =
        isObject(failure.current) && isObject(failure.current.actions)
          ? failure.current.actions
          : null;
      const evaluate = actions && isObject(actions.evaluate) ? actions.evaluate : null;
      const reason = evaluate && typeof evaluate.reason === 'string' ? evaluate.reason : null;
      return `Evaluate is no longer available: ${reason ?? failure.message}`;
    }
    return failure.message;
  }
  return 'The evaluation could not be started.';
}

/**
 * What to do about an evaluate run that stopped on the location gate: the reason it saved (as
 * plain text) and two answers. "Location is fine" starts a new evaluation that skips the gate;
 * "Not eligible" opens the discard popout with "Wrong location" ticked. Both are offered only
 * while the job is still Pending and no newer evaluate run exists.
 */
export function LocationReview({
  run,
  onChanged,
}: {
  run: RunRecord;
  /** Called after an answer was accepted, so the page can read the job again. */
  onChanged?: () => void;
}) {
  const { dispatchNonce, writerNonce } = useCapabilities();
  const jobId = run.jobId;
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!jobId || (!dispatchNonce && !writerNonce)) return;
    const controller = new AbortController();
    Promise.all([api.jobDetail(jobId, controller.signal), api.runs(controller.signal, jobId)]).then(
      ([detail, runs]) => {
        if (controller.signal.aborted) return;
        const newer = runs.data.runs.some(
          other =>
            other.action === 'evaluate' && other.id !== run.id && other.createdAt > run.createdAt,
        );
        setEligible(detail.data.job.status === 'Pending' && !newer);
      },
      () => {
        if (!controller.signal.aborted) setEligible(false);
      },
    );
    return () => controller.abort();
  }, [jobId, run.id, run.createdAt, dispatchNonce, writerNonce]);

  const evaluate = async () => {
    if (!jobId || !dispatchNonce || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await api.startJobRun(
        {
          action: 'evaluate',
          jobId,
          requestKey: `job-evaluate-${jobId}-${crypto.randomUUID()}`,
          locationConfirmed: true,
        },
        dispatchNonce,
        new AbortController().signal,
      );
      setEligible(false);
      setDone('Evaluation started without the location gate. Follow it on the Tasks page.');
      onChanged?.();
    } catch (failure) {
      setProblem(startFailureText(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const discard = async (reason: string) => {
    if (!jobId || !writerNonce || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setDiscardError(null);
    try {
      // Read the job again so the write checks the revision it has now, and only if it is Pending.
      const fresh = await api.jobDetail(jobId, new AbortController().signal);
      if (fresh.data.job.status !== 'Pending') {
        setAsking(false);
        setEligible(false);
        setProblem(`This job is no longer Pending (it is ${fresh.data.job.status}).`);
        return;
      }
      await api.changeStatus(
        jobId,
        { expectedRevision: fresh.data.job.revision, status: 'Discarded', reason },
        writerNonce,
        new AbortController().signal,
      );
      setAsking(false);
      setEligible(false);
      setDone('Discarded.');
      onChanged?.();
    } catch (failure) {
      if (conflictCode(failure) === 'REVISION_CONFLICT') {
        setAsking(false);
        setEligible(false);
        setProblem('This job was changed elsewhere, so nothing was discarded.');
      } else {
        setDiscardError(
          failure instanceof ApiFailure ? failure.message : 'The change could not be saved.',
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="location-review">
      <p className="location-reason">{run.detail ?? FALLBACK}</p>
      {eligible && (
        <div className="location-actions">
          {dispatchNonce && (
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void evaluate()}
            >
              Location is fine, evaluate
            </button>
          )}
          {writerNonce && (
            <button
              type="button"
              className="quick-move quick-move-reject"
              disabled={busy}
              onClick={() => {
                setDiscardError(null);
                setAsking(true);
              }}
            >
              Not eligible, discard
            </button>
          )}
        </div>
      )}
      {done && (
        <p className="location-note" role="status">
          {done}
        </p>
      )}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {asking && (
        <DiscardDialog
          title="Discard this job as not eligible?"
          description="Nothing else about the job changes."
          initialReason="Wrong location"
          busy={busy}
          error={discardError}
          onClose={() => setAsking(false)}
          onConfirm={reason => void discard(reason)}
        />
      )}
    </div>
  );
}

/** The job page: the latest evaluate run for the job, when it ended on the location gate. */
export function JobLocationReview({
  jobId,
  status,
  onChanged,
}: {
  jobId: string;
  status: string;
  onChanged?: () => void;
}) {
  const [run, setRun] = useState<RunRecord | null>(null);
  // Once an answer is accepted the heading goes; only the note about what happened stays.
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (status !== 'Pending') {
      setRun(null);
      return;
    }
    const controller = new AbortController();
    api.runs(controller.signal, jobId).then(
      result => {
        if (controller.signal.aborted) return;
        const latest = result.data.runs
          .filter(item => item.action === 'evaluate')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        setRun(latest && needsLocationDecision(latest) ? latest : null);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [jobId, status]);
  if (!run) return null;
  return (
    <section className="location-review-block" aria-label="Location decision needed">
      {!answered && <h4>Needs a location decision</h4>}
      <LocationReview
        run={run}
        onChanged={() => {
          setAnswered(true);
          onChanged?.();
        }}
      />
    </section>
  );
}
