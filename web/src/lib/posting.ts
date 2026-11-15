import { ApiFailure, type JobItem } from '../api';

type Posting = NonNullable<JobItem['posting']>;

export const postingStateText: Record<Posting['state'], string> = {
  open: 'Open',
  closed: 'Closed',
  probably_closed: 'Probably closed',
  unknown: 'Could not tell',
};

export const postingActionText: Record<Posting['action'], string> = {
  none: 'No action taken',
  flagged: 'Flagged for review',
  discarded: 'Discarded as "Posting expired"',
  held_back: 'Held back by the outage limit, not discarded',
};

/** A closed or probably closed latest check is what the list marks. */
export const postingIsClosed = (posting: JobItem['posting']) =>
  posting !== null && (posting.state === 'closed' || posting.state === 'probably_closed');

/** Plain words for a refused posting check; the same wording is used for one job and for all. */
export function postingCheckError(failure: unknown): string {
  if (failure instanceof ApiFailure) {
    if (failure.code === 'RUN_ACTIVE') return 'A posting check is already running.';
    if (failure.code === 'DISCOVERY_BUSY')
      return 'A scan or intake is running right now. Try again when it finishes.';
    if (failure.code === 'LOCAL_REQUEST_REJECTED')
      return 'The local session is no longer valid, so nothing was started. Reload the page and try again.';
    return failure.message;
  }
  return 'The posting check could not be started.';
}
