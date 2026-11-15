import { useRef, useState } from 'react';
import { ApiFailure } from '../api';
import { api } from '../lib/client';

function failureText(failure: unknown): string {
  if (failure instanceof ApiFailure) {
    if (failure.code === 'LOCAL_REQUEST_REJECTED')
      return 'The local session is no longer valid, so the favorite was not changed. Reload the page and try again.';
    if (failure.code === 'NOT_FOUND')
      return 'This job no longer exists, so the favorite was not changed.';
    return `The favorite was not changed. ${failure.message}`;
  }
  return 'The favorite was not changed.';
}

/**
 * A star that marks a job as a favorite. It is only a label: it never changes the job's status or
 * score. The change shows at once; if the server refuses it the star goes back and a plain line
 * says why. With `onError` the line is shown by the caller, otherwise under the star.
 */
export function FavoriteToggle({
  jobId,
  label,
  favorite,
  nonce,
  onApply,
  onError,
}: {
  jobId: string;
  /** Company and role, so the control is named for screen readers. */
  label: string;
  favorite: boolean;
  nonce: string;
  /** Show the given state in the page (called for the optimistic change and for a rollback). */
  onApply: (favorite: boolean) => void;
  onError?: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const report = (message: string | null) => (onError ? onError(message) : setProblem(message));
  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    report(null);
    const next = !favorite;
    onApply(next);
    try {
      await api.setFavorite(jobId, next, nonce, new AbortController().signal);
    } catch (failure) {
      onApply(!next);
      report(failureText(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <span className="favorite-wrap">
      <button
        type="button"
        className={`favorite-toggle${favorite ? ' is-favorite' : ''}`}
        aria-pressed={favorite}
        aria-disabled={busy}
        aria-label={`Favorite: ${label}`}
        title={
          favorite
            ? 'Remove from favorites (does not change status or score)'
            : 'Mark as favorite (does not change status or score)'
        }
        onClick={() => void toggle()}
      >
        <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
      </button>
      {problem && (
        <span className="favorite-problem" role="status">
          {problem}
        </span>
      )}
    </span>
  );
}
