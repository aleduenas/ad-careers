import type { ReactNode } from 'react';
import type { EndpointState, JobDetailResponse } from '../../api';

/** Loading, invalid-address, not-found and failed states, under the bare header bar. */
export function WorkspaceFallback({
  state,
  id,
  back,
  onRetry,
}: {
  state: Exclude<EndpointState<JobDetailResponse>, { kind: 'success' }>;
  id: string;
  back: ReactNode;
  onRetry: () => void;
}) {
  if (state.kind === 'loading')
    return (
      <div className="ws-plain">
        {back}
        <section className="empty-state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading job…
        </section>
      </div>
    );
  if (state.kind === 'error') {
    const { error } = state;
    if (error.code === 'INVALID_REQUEST' && error.fields?.id)
      return (
        <div className="ws-plain">
          {back}
          <section className="empty-state" role="status">
            <h3>This job address is not valid</h3>
            <p>Job IDs are whole numbers, for example #/jobs/12.</p>
          </section>
        </div>
      );
    if (error.code === 'NOT_FOUND')
      return (
        <div className="ws-plain">
          {back}
          <section className="empty-state" role="status">
            <h3>Job not found</h3>
            <p>No job with ID {id} exists in the database.</p>
          </section>
        </div>
      );
    const unavailable = error.code === 'DATABASE_UNAVAILABLE' || error.code === 'SCHEMA_NOT_READY';
    return (
      <div className="ws-plain">
        {back}
        <div className={`notice ${unavailable ? 'notice-warn' : 'notice-error'}`} role="alert">
          <div>
            <strong>
              {unavailable ? 'The database is unavailable.' : 'The job could not be loaded.'}
            </strong>
            <p>{error.message}</p>
          </div>
          <button className="quiet-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }
}
