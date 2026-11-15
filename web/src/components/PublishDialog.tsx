import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type DetailJob, type JobActions, type RunRecord } from '../api';
import { api } from '../lib/client';
import { isObject } from '../lib/errors';
import { trapTab } from '../lib/hooks';

export function PublishDialog({
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
