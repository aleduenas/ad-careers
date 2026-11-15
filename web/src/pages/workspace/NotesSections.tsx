import { visibleDiscardReason } from '../../lib/discard';
import type { DetailJob } from '../../api';

/** Notes and, for a discarded job, the discard reason: shared by both Status panel variants. */
export function NotesSections({ job }: { job: DetailJob }) {
  return (
    <>
      <section className="workspace-section" aria-labelledby="notes-title">
        <h3 id="notes-title">Notes</h3>
        {job.notes ? (
          <pre className="doc-text notes-text">{job.notes}</pre>
        ) : (
          <p className="missing-copy">No notes are recorded for this job.</p>
        )}
      </section>

      {job.status === 'Discarded' && (
        <section className="workspace-section" aria-labelledby="discard-title">
          <h3 id="discard-title">Discard reason</h3>
          <p className={visibleDiscardReason(job.discardReason) ? '' : 'missing-copy'}>
            {visibleDiscardReason(job.discardReason) ?? 'No reason was recorded.'}
          </p>
        </section>
      )}
    </>
  );
}
