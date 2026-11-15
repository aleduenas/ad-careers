import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type EndpointState, type LivenessSummary } from '../../api';
import { api } from '../../lib/client';
import { formatDateTime } from '../../lib/format';
import { trapTab } from '../../lib/hooks';
import { postingCheckError } from '../../lib/posting';

const POLL_MS = 4000;

function ConfirmDialog({
  onStart,
  onClose,
  busy,
  error,
}: {
  onStart: () => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      className="dialog"
      ref={ref}
      aria-labelledby="posting-dialog-title"
      aria-describedby="posting-dialog-copy"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={event => trapTab(event)}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="posting-dialog-title" tabIndex={-1}>
        Check every posting now?
      </h2>
      <p className="dialog-copy" id="posting-dialog-copy">
        This opens the public posting of each eligible job to see whether it is still open. Closed
        postings you have not applied to are discarded with the reason &ldquo;Posting
        expired&rdquo;; you can move any of them back from the job&rsquo;s page. Nothing else about
        a job changes.
      </p>
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={onStart}>
          {busy ? 'Starting…' : 'Check all now'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

export function PostingCheckCard({ nonce }: { nonce: string }) {
  const [summary, setSummary] = useState<EndpointState<LivenessSummary>>({ kind: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // After a start, treat the check as running until the summary says it has finished once.
  const [started, setStarted] = useState(false);
  const [tick, setTick] = useState(0);
  const sawRunning = useRef(false);
  const waits = useRef(0);
  const running = summary.kind === 'success' && summary.value.running;

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    api.livenessSummary(controller.signal).then(
      result => {
        if (controller.signal.aborted) return;
        setSummary({ kind: 'success', value: result.data });
        if (result.data.running) {
          sawRunning.current = true;
          timer = window.setTimeout(() => setTick(value => value + 1), POLL_MS);
        } else if (started && !sawRunning.current && waits.current < 8) {
          // Accepted but not reported as running yet: look again shortly.
          waits.current += 1;
          timer = window.setTimeout(() => setTick(value => value + 1), POLL_MS / 2);
        } else if (started) {
          setStarted(false);
          setNote(null);
        }
      },
      failure => {
        if (controller.signal.aborted) return;
        setSummary({
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
      window.clearTimeout(timer);
    };
  }, [tick]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.startLiveness(
        { action: 'liveness', requestKey: `liveness-${crypto.randomUUID()}` },
        nonce,
        new AbortController().signal,
      );
      setConfirming(false);
      sawRunning.current = false;
      waits.current = 0;
      setStarted(true);
      setNote('The posting check started. Follow it on the Tasks page.');
      setTick(value => value + 1);
    } catch (failure) {
      setError(postingCheckError(failure));
    } finally {
      setBusy(false);
    }
  };

  const last = summary.kind === 'success' ? summary.value.lastFullCheck : null;
  const counts: [string, number][] = last
    ? [
        ['Checked', last.checked],
        ['Open', last.open],
        ['Closed', last.closed],
        ['Probably closed', last.probablyClosed],
        ['Could not tell', last.unknown],
        ['Discarded', last.discarded],
        ['Flagged', last.flagged],
        ['Held back by the outage limit', last.heldBack],
      ]
    : [];
  return (
    <section className="edit-card discover-card" aria-labelledby="posting-title">
      <h3 id="posting-title">Posting check</h3>
      <p className="pane-meta">
        Looks at each posting to see whether it is still open. Runs once a day, and when you start
        it.
      </p>
      {summary.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading the last check…
        </p>
      )}
      {summary.kind === 'error' && (
        <div className="notice notice-error" role="alert">
          <div>
            <strong>The last check could not be read.</strong>
            <p>{summary.error.message}</p>
          </div>
          <button className="quiet-button" onClick={() => setTick(value => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {summary.kind === 'success' && !last && (
        <p className="pane-meta">No full check has run yet.</p>
      )}
      {last && (
        <>
          <p className="pane-meta">Last full check: {formatDateTime(last.finishedAt)}</p>
          <dl className="posting-counts">
            {counts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {(running || started) && (
        <p className="pane-meta posting-running" role="status">
          <span className="spinner" aria-hidden="true" /> A posting check is running.
        </p>
      )}
      {note && !running && !started && (
        <p className="pane-meta" role="status">
          {note}
        </p>
      )}
      {error && !confirming && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="edit-actions">
        <button
          className="primary-button"
          disabled={running || started || summary.kind === 'loading'}
          onClick={() => {
            setError(null);
            setNote(null);
            setConfirming(true);
          }}
        >
          Check all now
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          busy={busy}
          error={error}
          onStart={() => void start()}
          onClose={() => {
            setConfirming(false);
            setError(null);
          }}
        />
      )}
    </section>
  );
}
