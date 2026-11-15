import { ApiFailure } from '../api';

export function writeErrorText(error: unknown): string {
  if (!(error instanceof ApiFailure)) return 'The change could not be saved.';
  if (error.code === 'LOCAL_REQUEST_REJECTED')
    return 'The local session is no longer valid, so nothing was saved. Reload the page and try again.';
  if (error.code === 'NOT_FOUND') return 'This job no longer exists.';
  return error.message;
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiFailure && error.fields ? error.fields : {};
}

export function activeRunId(error: unknown): string | null {
  if (!(error instanceof ApiFailure) || !isObject(error.current)) return null;
  const value = error.current.activeRunId;
  return typeof value === 'string' && value ? value : null;
}

/** DUPLICATE_JOB carries current.tracked, the job that already uses the link. */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the tracked job's status is, and for a Discarded one when and why it was discarded. */
