import { useState } from 'react';
import { conflictCode, type DetailJob, type JobDetailJd, type WritableStatus } from '../../api';
import { api } from '../../lib/client';
import type { DetailData } from '../../lib/materials';
import { writeErrorText, fieldErrors } from '../../lib/errors';
import { DiscardDialog } from '../../components/DiscardDialog';

export interface EditContext {
  id: string;
  nonce: string;
  /** Re-read the job silently (no loading state) and return the fresh detail, or null on failure. */
  refresh: () => Promise<DetailData | null>;
  /** Show a job returned by a successful write straight away. */
  applyJob: (job: DetailJob) => void;
  /** Show the job and JD returned by a successful JD save without a second read. */
  applyJd: (job: DetailJob, jd: JobDetailJd) => void;
}

const writableStatuses: WritableStatus[] = [
  'Applied',
  'Rejected',
  'Interview',
  'Offer',
  'Pending',
  'Evaluated',
  'Discarded',
];

export function StatusControl({ job, ctx }: { job: DetailJob; ctx: EditContext }) {
  const [target, setTarget] = useState<WritableStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const changed = target !== null && target !== job.status;

  const confirm = async (reason = '') => {
    if (!target) return;
    setBusy(true);
    setError(null);
    setConflict(null);
    setDone(null);
    try {
      const result = await api.changeStatus(
        ctx.id,
        { expectedRevision: job.revision, status: target, reason },
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJob(result.data.job);
      void ctx.refresh();
      setDone(`Status changed from ${job.status} to ${target}.`);
      setTarget(null);
      setAsking(false);
    } catch (failure) {
      if (conflictCode(failure) === 'REVISION_CONFLICT') {
        setAsking(false);
        const fresh = await ctx.refresh();
        setConflict(
          fresh
            ? `This job was changed elsewhere. It is now ${fresh.job.status} (revision ${fresh.job.revision}). Your choice is kept below. Confirm again to apply it to the current version.`
            : 'This job was changed elsewhere. Reload the page to see the current status. Your choice is kept below.',
        );
      } else {
        setError(fieldErrors(failure).reason ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="edit-card" aria-labelledby="status-edit-title">
      <h3 id="status-edit-title">Change status</h3>
      <p className="pane-meta">
        Current status: <strong>{job.status}</strong>
        {job.status === 'Ghosted' && ' (set automatically; choose a status to change it)'}
      </p>
      <div className="edit-row">
        <label>
          New status
          <select
            value={target ?? job.status}
            disabled={busy}
            onChange={event => {
              const next = event.target.value as WritableStatus;
              setTarget(next === job.status ? null : next);
              setDone(null);
              setError(null);
            }}
          >
            {!writableStatuses.includes(job.status as WritableStatus) && (
              <option value={job.status} disabled>
                {job.status} (automatic)
              </option>
            )}
            {writableStatuses.map(status => (
              <option key={status} value={status}>
                {status}
                {status === job.status ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {changed && (
        <div className="edit-actions">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => (target === 'Discarded' ? setAsking(true) : void confirm())}
          >
            {busy ? 'Saving…' : `Confirm: change to ${target}`}
          </button>
          <button
            className="quiet-button"
            disabled={busy}
            onClick={() => {
              setTarget(null);
              setError(null);
              setConflict(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {asking && target === 'Discarded' && (
        <DiscardDialog
          title="Discard this job?"
          description="Nothing else about the job changes."
          busy={busy}
          error={error}
          onClose={() => {
            setAsking(false);
            setError(null);
          }}
          onConfirm={reason => void confirm(reason)}
        />
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <p>{conflict}</p>
        </div>
      )}
      {error && !asking && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {done && (
        <p className="success-copy" role="status">
          {done}
        </p>
      )}
    </section>
  );
}
