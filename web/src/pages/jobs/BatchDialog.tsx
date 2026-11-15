import { useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  type BatchRequest,
  type BatchResult,
  type BatchSkip,
  type EndpointState,
  type ProviderSettings,
} from '../../api';
import { api } from '../../lib/client';
import { isObject } from '../../lib/errors';
import { trapTab } from '../../lib/hooks';
import { providerLabels } from '../../lib/providers';
import './batch.css';

/** What the dialog was opened for. "custom" holds the amount field itself. */
export type BatchIntent =
  | { kind: 'selected'; jobIds: [string, ...string[]] }
  | { kind: 'next'; count: number }
  | { kind: 'custom' };

export type BatchOutcome =
  { kind: 'started'; result: BatchResult } | { kind: 'none'; skipped: BatchSkip[] };

export const BATCH_MIN = 1;
export const BATCH_MAX = 100;

/** The words for a refused batch start; the dialog stays open and shows them. */
export function batchErrorText(failure: unknown): string {
  if (failure instanceof ApiFailure) {
    if (failure.code === 'LOCAL_REQUEST_REJECTED')
      return 'The local session is no longer valid, so nothing was started. Reload the page and try again.';
    if (failure.code === 'PREREQUISITE_FAILED')
      return `Evaluate is no longer available: ${failure.message}`;
    return failure.message;
  }
  return 'The evaluations could not be started.';
}

function skippedFrom(failure: ApiFailure): BatchSkip[] {
  const list = isObject(failure.current) ? failure.current.skipped : undefined;
  return Array.isArray(list)
    ? list.filter(
        (item): item is BatchSkip =>
          isObject(item) && typeof item.jobId === 'string' && typeof item.reason === 'string',
      )
    : [];
}

/** Parses the amount field: whole numbers from 1 to 100 only. */
export function parseAmount(text: string): { value: number | null; problem: string | null } {
  const trimmed = text.trim();
  const problem = `Enter a whole number from ${BATCH_MIN} to ${BATCH_MAX}.`;
  if (!/^[0-9]{1,3}$/.test(trimmed)) return { value: null, problem };
  const value = Number(trimmed);
  if (value < BATCH_MIN || value > BATCH_MAX) return { value: null, problem };
  return { value, problem: null };
}

export function BatchDialog({
  intent,
  nonce,
  onClose,
  onOutcome,
}: {
  intent: BatchIntent;
  nonce: string;
  onClose: () => void;
  onOutcome: (outcome: BatchOutcome) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [settings, setSettings] = useState<EndpointState<ProviderSettings>>({ kind: 'loading' });
  const [amount, setAmount] = useState('10');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per distinct request: a retry of the same body replays instead of starting twice.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    const controller = new AbortController();
    api.providerSettings(controller.signal).then(
      result => {
        if (!controller.signal.aborted) setSettings({ kind: 'success', value: result.data });
      },
      failure => {
        if (!controller.signal.aborted)
          setSettings({
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
      dialog?.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const saved = settings.kind === 'success' ? settings.value.functions.evaluation : null;
  const custom = intent.kind === 'custom';
  const count =
    intent.kind === 'selected' ? intent.jobIds.length : intent.kind === 'next' ? intent.count : 0;

  const start = async () => {
    if (busy) return;
    let body: Omit<BatchRequest, 'requestKey'>;
    if (intent.kind === 'selected') body = { jobIds: intent.jobIds };
    else if (intent.kind === 'next') body = { next: intent.count };
    else {
      const checked = parseAmount(amount);
      setProblem(checked.problem);
      if (checked.value === null) return;
      body = { next: checked.value };
    }
    const serial = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== serial)
      attempt.current = { body: serial, key: `batch-evaluate-${crypto.randomUUID()}` };
    setBusy(true);
    setError(null);
    try {
      const result = await api.startEvaluateBatch(
        { ...body, requestKey: attempt.current.key } as BatchRequest,
        nonce,
        new AbortController().signal,
      );
      onOutcome({ kind: 'started', result: result.data });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'NO_ELIGIBLE_JOBS') {
        onOutcome({ kind: 'none', skipped: skippedFrom(failure) });
      } else {
        setError(batchErrorText(failure));
        setBusy(false);
      }
    }
  };

  const title =
    intent.kind === 'selected'
      ? `Evaluate ${count} selected ${count === 1 ? 'job' : 'jobs'}?`
      : intent.kind === 'next'
        ? `Evaluate the next ${count} pending jobs?`
        : 'Evaluate the next pending jobs?';
  const lead =
    intent.kind === 'selected'
      ? `This starts ${count} ${count === 1 ? 'evaluation' : 'evaluations'}.`
      : intent.kind === 'next'
        ? `This starts up to ${count} evaluations on the oldest Pending jobs.`
        : 'This starts evaluations on the oldest Pending jobs, up to the number below.';

  return (
    <dialog
      className="dialog batch-dialog"
      ref={ref}
      aria-labelledby="batch-dialog-title"
      aria-describedby="batch-dialog-copy"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={event => trapTab(event)}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="batch-dialog-title" tabIndex={-1}>
        {title}
      </h2>
      <p className="dialog-copy" id="batch-dialog-copy">
        {lead} They use your saved Evaluate provider and model
        {saved ? ` (${providerLabels[saved.provider]} / ${saved.model})` : ''}, which are not
        changed. Only a few run at a time and the rest wait their turn; each can take several
        minutes. Jobs that cannot be evaluated are skipped and listed afterwards.
      </p>
      {custom && (
        <div className="batch-amount">
          <label htmlFor="batch-amount-input">
            How many pending jobs ({BATCH_MIN} to {BATCH_MAX})
          </label>
          <input
            id="batch-amount-input"
            type="number"
            inputMode="numeric"
            min={BATCH_MIN}
            max={BATCH_MAX}
            step={1}
            value={amount}
            disabled={busy}
            autoFocus
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? 'batch-amount-problem' : undefined}
            onChange={event => {
              setAmount(event.target.value);
              setProblem(null);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void start();
              }
            }}
          />
          {problem && (
            <p className="field-error" id="batch-amount-problem" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="dialog-actions batch-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? 'Starting…' : 'Start'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
