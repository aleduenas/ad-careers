import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  commentRoom,
  discardProblem,
  discardReasons,
  discardReasonText,
  NO_REASON,
} from '../lib/discard';
import { trapTab } from '../lib/hooks';

const SHOW_REMAINING_AT = 40;

/**
 * One popout for every discard: the reasons as tick boxes (one at a time) plus an optional
 * comment. Nothing has to be chosen: the confirm button is ready and has focus, so Enter
 * discards with "No reason given". The caller decides what confirming does.
 */
export function DiscardDialog({
  title,
  description,
  initialReason = null,
  count = 1,
  busy,
  busyLabel = 'Discarding…',
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  /** A reason that starts ticked (for example "Wrong location"); it can be changed or cleared. */
  initialReason?: string | null;
  /** How many jobs this discards; the confirm button says so when it is more than one. */
  count?: number;
  busy: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const [chosen, setChosen] = useState<string | null>(initialReason);
  const [comment, setComment] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    confirmButton.current?.focus();
    return () => {
      dialog?.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  const problem = discardProblem(chosen, comment);
  const room = commentRoom(chosen);
  const remaining = room - comment.trim().length;
  return (
    <dialog
      className="dialog discard-dialog"
      ref={ref}
      aria-labelledby="discard-dialog-title"
      aria-describedby="discard-dialog-copy"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={event => trapTab(event)}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="discard-dialog-title" tabIndex={-1}>
        {title}
      </h2>
      <p className="dialog-copy" id="discard-dialog-copy">
        {description} A reason is optional; without one the job is recorded as &ldquo;{NO_REASON}
        &rdquo;.
      </p>
      <fieldset className="discard-reasons" disabled={busy}>
        <legend>Reason (optional, one at a time)</legend>
        <div className="discard-reason-grid">
          {discardReasons.map(item => (
            <label key={item} className="discard-reason">
              <input
                type="checkbox"
                checked={chosen === item}
                onChange={event => setChosen(event.target.checked ? item : null)}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="discard-comment">
        Comment (optional)
        <input
          type="text"
          value={comment}
          disabled={busy}
          maxLength={Math.max(0, room)}
          aria-describedby={remaining <= SHOW_REMAINING_AT ? 'discard-remaining' : undefined}
          onChange={event => setComment(event.target.value)}
          onKeyDown={event => {
            // Enter in the comment box must not discard by accident.
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </label>
      {remaining <= SHOW_REMAINING_AT && (
        <p className="pane-meta" id="discard-remaining" aria-live="polite">
          {remaining} {remaining === 1 ? 'character' : 'characters'} left
        </p>
      )}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          ref={confirmButton}
          className="discard-danger"
          disabled={busy || Boolean(problem)}
          onClick={() => onConfirm(discardReasonText(chosen, comment))}
        >
          {busy ? busyLabel : count > 1 ? `Discard ${count}` : 'Discard'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
