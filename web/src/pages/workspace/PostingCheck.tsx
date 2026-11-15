import { useEffect, useRef, useState } from 'react';
import type { DetailJob } from '../../api';
import { api } from '../../lib/client';
import { formatDate, formatDateTime } from '../../lib/format';
import { postingActionText, postingCheckError, postingStateText } from '../../lib/posting';

const POLL_MS = 3000;

/** True when the posting check is what discarded this job, which can still be moved back. */
export const expiredByCheck = (job: DetailJob) =>
  job.status === 'Discarded' && job.posting !== null && job.posting.action === 'discarded';

/** "Posting expired on <date>": shown next to the move-back control for a job the check discarded. */
export function PostingExpiredLine({ job }: { job: DetailJob }) {
  if (!expiredByCheck(job) || !job.posting) return null;
  return (
    <p className="posting-expired" role="note">
      Posting expired on {formatDate(job.posting.checkedAt.slice(0, 10))}. The check discarded this
      job; move it back below if the posting is still wanted.
    </p>
  );
}

/** The latest posting check for one job, and a button that checks it again. */
export function PostingFact({
  job,
  nonce,
  onChecked,
}: {
  job: DetailJob;
  /** Present when the server can start runs. */
  nonce: string | null;
  /** Read the job again after a check finishes. */
  onChecked: () => void | Promise<unknown>;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(onChecked);
  done.current = onChecked;

  // While the check this page started is queued or running, look at it until it ends.
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer = 0;
    const look = () =>
      api.run(runId, controller.signal).then(
        result => {
          if (controller.signal.aborted) return;
          const run = result.data.run;
          if (run.state === 'queued' || run.state === 'running') {
            timer = window.setTimeout(look, POLL_MS);
            return;
          }
          setRunId(null);
          if (run.state === 'completed') setMessage('The posting check finished.');
          else {
            setMessage(null);
            setProblem('The posting check did not finish. See the Tasks page.');
          }
          void done.current();
        },
        () => {
          if (!controller.signal.aborted) timer = window.setTimeout(look, POLL_MS * 2);
        },
      );
    timer = window.setTimeout(look, POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [runId]);

  const check = async () => {
    if (!nonce || busy) return;
    setBusy(true);
    setMessage(null);
    setProblem(null);
    try {
      const result = await api.startLiveness(
        {
          action: 'liveness',
          requestKey: `liveness-${job.id}-${crypto.randomUUID()}`,
          jobId: job.id,
        },
        nonce,
        new AbortController().signal,
      );
      setRunId(result.data.runs[0].id);
      setMessage('Checking the posting…');
    } catch (failure) {
      setMessage(null);
      setProblem(postingCheckError(failure));
    } finally {
      setBusy(false);
    }
  };

  const posting = job.posting;
  return (
    <>
      <span
        title={posting ? `${posting.method}: ${posting.detail}` : undefined}
        className="posting-fact-text"
      >
        {posting
          ? `${postingStateText[posting.state]} · ${formatDateTime(posting.checkedAt)}`
          : 'Not checked yet'}
      </span>
      {posting && posting.action !== 'none' && (
        <small className="posting-fact-action">
          {posting.action === 'discarded' && job.status !== 'Discarded'
            ? 'Discarded by this check, since moved back'
            : postingActionText[posting.action]}
        </small>
      )}
      {nonce && (
        <button
          type="button"
          className="quiet-button posting-check-button"
          disabled={busy || runId !== null}
          onClick={() => void check()}
        >
          {busy || runId !== null ? 'Checking…' : 'Check posting'}
        </button>
      )}
      {message && (
        <small className="posting-fact-note" role="status">
          {message}
        </small>
      )}
      {problem && (
        <small className="field-error" role="alert">
          {problem}
        </small>
      )}
    </>
  );
}
