import { useState, type RefObject } from 'react';
import { ApiFailure, conflictCode } from '../../api';
import { api } from '../../lib/client';
import { DiscardDialog } from '../../components/DiscardDialog';

/** A row picked for discarding: its id, the revision the list showed, and its name. */
export interface DiscardTarget {
  id: string;
  revision: string;
  label: string;
}

export interface DiscardFailure {
  id: string;
  label: string;
  reason: string;
}

export interface DiscardOutcome {
  discarded: string[];
  failed: DiscardFailure[];
}

const PARALLEL = 3;

/** Plain words for one job that could not be discarded; the rest of the batch carries on. */
export function discardFailureText(failure: unknown): string {
  if (conflictCode(failure) === 'REVISION_CONFLICT')
    return 'It changed since the list loaded, so it was left as it is.';
  if (failure instanceof ApiFailure) {
    if (failure.code === 'NOT_FOUND') return 'It no longer exists.';
    if (failure.code === 'LOCAL_REQUEST_REJECTED')
      return 'The write was refused: the local session is no longer valid. Reload the page.';
    return failure.message;
  }
  return 'The change could not be saved.';
}

/** Discards each target through the single-job status write, a few at a time; never stops early. */
export async function discardAll(
  targets: DiscardTarget[],
  reason: string,
  nonce: string,
  onProgress: (done: number) => void,
): Promise<DiscardOutcome> {
  const outcome: DiscardOutcome = { discarded: [], failed: [] };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < targets.length) {
      const target = targets[next++];
      try {
        await api.changeStatus(
          target.id,
          { expectedRevision: target.revision, status: 'Discarded', reason },
          nonce,
          new AbortController().signal,
        );
        outcome.discarded.push(target.id);
      } catch (failure) {
        outcome.failed.push({
          id: target.id,
          label: target.label,
          reason: discardFailureText(failure),
        });
      }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, targets.length) }, worker));
  return outcome;
}

export function BatchDiscardDialog({
  targets,
  nonce,
  onClose,
  onDone,
}: {
  targets: DiscardTarget[];
  nonce: string;
  onClose: () => void;
  onDone: (outcome: DiscardOutcome) => void;
}) {
  const [done, setDone] = useState<number | null>(null);
  const count = targets.length;
  return (
    <DiscardDialog
      title={`Discard ${count} selected ${count === 1 ? 'job' : 'jobs'}?`}
      description={
        <>
          The same reason is recorded for all {count}. Nothing else about the{' '}
          {count === 1 ? 'job changes' : 'jobs change'}. A job that changed since the list loaded is
          left as it is and listed afterwards.
        </>
      }
      count={count}
      busy={done !== null}
      busyLabel={`Discarding ${done ?? 0} of ${count}…`}
      onClose={onClose}
      onConfirm={async reason => {
        setDone(0);
        onDone(await discardAll(targets, reason, nonce, setDone));
      }}
    />
  );
}

/** The result line after a batch discard: how many went, and each job that did not, with why. */
export function DiscardResult({
  outcome,
  onDismiss,
  innerRef,
}: {
  outcome: DiscardOutcome;
  onDismiss: () => void;
  innerRef: RefObject<HTMLDivElement | null>;
}) {
  const { discarded, failed } = outcome;
  return (
    <div
      className={`notice batch-status ${failed.length ? 'notice-warn' : ''}`}
      role="status"
      tabIndex={-1}
      ref={innerRef}
    >
      <div className="batch-status-body">
        <p>
          <strong>
            Discarded {discarded.length} {discarded.length === 1 ? 'job' : 'jobs'}.
          </strong>
        </p>
        {failed.length > 0 && (
          <div className="batch-skipped">
            <p>
              Not discarded: {failed.length} {failed.length === 1 ? 'job' : 'jobs'}:
            </p>
            <ul>
              {failed.map(item => (
                <li key={item.id}>
                  <a href={`${location.search}#/jobs/${item.id}`}>Job {item.id}</a> ({item.label}):{' '}
                  {item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="batch-status-actions">
        <button type="button" className="quiet-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
