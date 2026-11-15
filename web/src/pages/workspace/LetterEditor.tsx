import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type LetterData, letterPdfHref } from '../../api';
import { api } from '../../lib/client';
import { formatDateTime } from '../../lib/format';
import { writeErrorText, fieldErrors, isObject } from '../../lib/errors';
import { useReturnFocus, useLeaveGuard, trapTab } from '../../lib/hooks';

// ---- Package 3.5: cover-letter editor and Publish PDF.
// Saving never publishes, publishing never regenerates text and nothing starts on load. The editor
// needs jobWrites; Publish PDF needs taskDispatch. The PDF is always labelled a draft.

const letterDrafts = new Map<string, string>();

const letterLimitBytes = 256 * 1024;

const normalizeLetter = (text: string) => text.replace(/\r\n?/g, '\n');

type LetterState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: LetterData };

export function useLetter(id: string, wanted: boolean, stamp: string) {
  const [state, setState] = useState<LetterState>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!wanted) {
      setState({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState(previous => (previous.kind === 'ok' ? previous : { kind: 'loading' }));
    api.letter(id, controller.signal).then(
      result => {
        if (!controller.signal.aborted) setState({ kind: 'ok', data: result.data });
      },
      failure => {
        if (controller.signal.aborted) return;
        // A failed refresh never replaces a letter that was already read.
        setState(previous =>
          previous.kind === 'ok'
            ? previous
            : {
                kind: 'error',
                message:
                  failure instanceof ApiFailure ? failure.message : 'The letter could not be read.',
              },
        );
      },
    );
    return () => controller.abort();
  }, [id, wanted, stamp, tick]);
  return {
    state,
    reload: () => setTick(value => value + 1),
    apply: (data: LetterData) => setState({ kind: 'ok', data }),
  };
}

function LetterEditor({
  id,
  nonce,
  letter,
  onApply,
  onDirty,
  onReload,
  dialog = false,
  onClosed,
}: {
  id: string;
  nonce: string;
  letter: LetterData;
  onApply: (data: LetterData) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
  /** Inside the letter modal: starts editing, stays open after a save, Cancel closes the modal. */
  dialog?: boolean;
  onClosed?: () => void;
}) {
  const stored = normalizeLetter(letter.text);
  const [editing, setEditing] = useState(() => dialog || letterDrafts.has(id));
  const [text, setText] = useState(() => letterDrafts.get(id) ?? stored);
  const [restored] = useState(() => letterDrafts.has(id));
  const [base, setBase] = useState(letter.contentHash);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ text: string; contentHash: string } | null>(null);
  const [shelved, setShelved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = editing && text !== stored;
  const editButton = useReturnFocus(editing);

  useEffect(() => {
    if (dirty) letterDrafts.set(id, text);
    else letterDrafts.delete(id);
  }, [dirty, text, id]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  useLeaveGuard(
    dirty,
    'You have unsaved changes to the cover letter. Leave this page? Your text is kept until you reload.',
  );

  const start = () => {
    setText(stored);
    setBase(letter.contentHash);
    setError(null);
    setConflict(null);
    setShelved(null);
    setSaved(false);
    setEditing(true);
  };
  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to the cover letter?')) return;
    if (dialog) letterDrafts.delete(id);
    setEditing(false);
    setError(null);
    setConflict(null);
    setShelved(null);
    onClosed?.();
  };
  const save = async () => {
    if (!text.trim()) {
      setError('The cover letter cannot be blank.');
      return;
    }
    if (new TextEncoder().encode(text).length > letterLimitBytes) {
      setError('The cover letter is larger than 256 KB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveLetter(
        id,
        { expectedHash: base, text },
        nonce,
        new AbortController().signal,
      );
      onApply(result.data);
      setBase(result.data.contentHash);
      if (!dialog) setEditing(false);
      setConflict(null);
      setShelved(null);
      setSaved(true);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'LETTER_CONFLICT') {
        const current =
          isObject(failure.current) &&
          typeof failure.current.text === 'string' &&
          typeof failure.current.contentHash === 'string'
            ? { text: failure.current.text, contentHash: failure.current.contentHash }
            : null;
        if (current) {
          setConflict(current);
          setBase(current.contentHash);
        } else {
          setError('The cover letter was changed elsewhere. Reload the page to see it.');
        }
      } else if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') {
        setError(
          'A letter or publish run for this job is active, so nothing was saved. Try again when it finishes. Your text is kept.',
        );
      } else if (failure instanceof ApiFailure && failure.code === 'LETTER_NOT_EDITABLE') {
        setError('This cover letter cannot be edited here. Your text is kept.');
        onReload();
      } else {
        setError(fieldErrors(failure).text ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!editing && dialog) return null;
  if (!editing)
    return (
      <div className="edit-actions">
        <button className="quiet-button" ref={editButton} onClick={start}>
          Edit cover letter
        </button>
        {saved && (
          <span className="success-copy" role="status">
            Cover letter saved. The PDF was not changed; use Publish PDF to render it.
          </span>
        )}
      </div>
    );
  return (
    <div className="jd-editor letter-editor">
      {restored && !saved && (
        <p className="pane-meta">Restored your unsaved changes from earlier in this session.</p>
      )}
      <label htmlFor="letter-text" className="visually-hidden">
        Cover letter text
      </label>
      <textarea
        id="letter-text"
        autoFocus
        className="doc-edit"
        value={text}
        spellCheck
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'letter-error' : undefined}
        onChange={event => setText(event.target.value)}
      />
      {error && (
        <p className="field-error" id="letter-error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              The saved cover letter changed elsewhere. Your text is kept in the box above and
              nothing was overwritten.
            </p>
            <details>
              <summary>Show the current saved text</summary>
              <pre className="doc-text conflict-text">{normalizeLetter(conflict.text)}</pre>
            </details>
            <div className="edit-actions">
              {shelved === null ? (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setShelved(text);
                    setText(normalizeLetter(conflict.text));
                  }}
                >
                  Load current text (keeps my text aside)
                </button>
              ) : (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setText(shelved);
                    setShelved(null);
                  }}
                >
                  Restore my text
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : conflict ? 'Save over current version' : 'Save cover letter'}
        </button>
        <button
          className="quiet-button"
          disabled={busy || !dirty}
          onClick={() => {
            setText(stored);
            setError(null);
          }}
        >
          Revert
        </button>
        <button className="quiet-button" disabled={busy} onClick={close}>
          {dialog ? 'Cancel' : 'Close editor'}
        </button>
        {dirty && <span className="pane-meta">Unsaved changes</span>}
        {dialog && saved && !dirty && (
          <span className="success-copy" role="status">
            Saved. The PDF was not changed; use Publish PDF to render it.
          </span>
        )}
      </div>
    </div>
  );
}

export function LetterSection({
  jobId,
  letter,
  writer,
  onApply,
  onDirty,
  onReload,
}: {
  jobId: string;
  letter: LetterState;
  writer: { nonce: string } | null;
  onApply: (data: LetterData) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
}) {
  if (letter.kind === 'idle') return null;
  return (
    <div className="letter-section" role="group" aria-label="Cover letter editor and PDF">
      {letter.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading the cover letter…
        </p>
      )}
      {letter.kind === 'error' && (
        <p className="missing-copy">
          The cover letter could not be loaded. Reload the page to try again.
        </p>
      )}
      {letter.kind === 'ok' && (
        <>
          {writer && letter.data.editable && (
            <LetterEditor
              id={jobId}
              nonce={writer.nonce}
              letter={letter.data}
              onApply={onApply}
              onDirty={onDirty}
              onReload={onReload}
            />
          )}
          {!letter.data.editable && (
            <p className="missing-copy">
              This cover letter is too large or not valid text, so it cannot be edited here.
            </p>
          )}
          {letter.data.pdf ? (
            <p className="letter-pdf">
              <strong>Cover letter PDF (draft)</strong>
              <span>
                {letter.data.pdf.name} · Modified {formatDateTime(letter.data.pdf.modifiedAt)} · A
                draft for your review, not sent to anyone.
              </span>{' '}
              <a href={letterPdfHref(jobId)} target="_blank" rel="noopener noreferrer">
                Open PDF (new tab)
              </a>
            </p>
          ) : (
            <p className="pane-meta">No PDF has been published for this letter yet.</p>
          )}
        </>
      )}
    </div>
  );
}

/** F39: the header's Cover letter cell opens this plain-text editor in a centered native dialog. */

export function LetterModal({
  jobId,
  letter,
  writer,
  fileHref,
  fileName,
  canPublish,
  publishNote,
  onPublish,
  onApply,
  onDirty,
  onReload,
  onClose,
}: {
  jobId: string;
  letter: LetterData;
  writer: { nonce: string } | null;
  fileHref: string;
  fileName: string;
  /** Publish PDF is offered when a dispatch capability exists. */
  canPublish: boolean;
  /** Why Publish PDF cannot start right now, or null. */
  publishNote: string | null;
  onPublish: () => void;
  onApply: (data: LetterData) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  const requestClose = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to the cover letter?')) return;
    if (dirty) letterDrafts.delete(jobId);
    onClose();
  };
  const editable = Boolean(writer) && letter.editable;
  return (
    <dialog
      className="dialog letter-modal"
      ref={ref}
      aria-labelledby="letter-modal-title"
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={trapTab}
    >
      <div className="letter-modal-head">
        <h2 id="letter-modal-title">Cover letter</h2>
        <button
          type="button"
          className="quiet-button dialog-close"
          aria-label="Close the cover letter"
          onClick={requestClose}
        >
          ×
        </button>
      </div>
      {editable && writer ? (
        <LetterEditor
          id={jobId}
          nonce={writer.nonce}
          letter={letter}
          onApply={onApply}
          onDirty={value => {
            setDirty(value);
            onDirty(value);
          }}
          onReload={onReload}
          dialog
          onClosed={onClose}
        />
      ) : (
        <>
          <p className="pane-meta">
            {letter.editable
              ? 'Editing is not available in this session.'
              : 'This cover letter is too large or not valid text, so it cannot be edited here.'}
          </p>
          {letter.editable && (
            <pre className="doc-text letter-modal-read">{normalizeLetter(letter.text)}</pre>
          )}
          <div className="edit-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
      <div className="letter-modal-foot">
        {canPublish && (
          <button
            type="button"
            className="quiet-button"
            disabled={publishNote !== null}
            aria-describedby={publishNote ? 'letter-modal-publish-note' : undefined}
            onClick={onPublish}
          >
            Publish PDF
          </button>
        )}
        {canPublish && publishNote && (
          <span className="pane-meta" id="letter-modal-publish-note">
            {publishNote}
          </span>
        )}
        <a className="letter-modal-file" href={fileHref} target="_blank" rel="noopener noreferrer">
          Open file ({fileName}, new tab)
        </a>
      </div>
    </dialog>
  );
}
