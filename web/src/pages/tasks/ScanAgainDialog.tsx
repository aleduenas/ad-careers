import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type RunRecord } from '../../api';
import { api } from '../../lib/client';
import { activeRunId } from '../../lib/errors';
import { trapTab } from '../../lib/hooks';

export function ScanAgainDialog({
  run,
  nonce,
  onClose,
  onStarted,
  onBusy,
}: {
  run: RunRecord;
  nonce: string;
  onClose: () => void;
  onStarted: () => void;
  onBusy: (runId: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const previous = (run.selection ?? {}) as { dryRun?: boolean; company?: string | null };
  const [dry, setDry] = useState(previous.dryRun === true);
  const [company, setCompany] = useState(previous.company ?? '');
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
      await api.startScan(
        {
          action: 'scan',
          requestKey: `scan-${crypto.randomUUID()}`,
          dryRun: dry,
          ...(company.trim() ? { company: company.trim() } : {}),
        },
        nonce,
        new AbortController().signal,
      );
      onStarted();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'DISCOVERY_BUSY') {
        onBusy(activeRunId(failure));
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError('The local session is no longer valid, so nothing was started. Reload the page.');
      } else {
        setError(
          failure instanceof ApiFailure ? failure.message : 'The scan could not be started.',
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
      aria-labelledby="scan-again-title"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={trapTab}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="scan-again-title">Start the portal scan again?</h2>
      <p className="pane-meta">
        This is a new run. It runs in the background. A dry run shows what a scan would find without
        saving anything.
      </p>
      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={dry}
          disabled={busy}
          onChange={event => setDry(event.target.checked)}
        />{' '}
        Dry run (save nothing)
      </label>
      <label className="scan-filter">
        Company filter (optional)
        <input
          type="text"
          value={company}
          maxLength={100}
          disabled={busy}
          placeholder="Leave empty to scan everything"
          onChange={event => setCompany(event.target.value)}
        />
      </label>
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting...' : 'Start'}
        </button>
        <button className="quiet-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
