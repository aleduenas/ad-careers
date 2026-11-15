import { useEffect, useState } from 'react';
import { conflictCode, type JobDetailJd } from '../../api';
import { api } from '../../lib/client';
import { formatDateTime } from '../../lib/format';
import type { EditContext } from './StatusControl';
import { writeErrorText, fieldErrors } from '../../lib/errors';
import { useReturnFocus } from '../../lib/hooks';
import { JdText } from './JdText';

// Unsaved JD text survives leaving the workspace within the same browser session.
const jdDrafts = new Map<string, string>();

const jdLimitBytes = 2 * 1024 * 1024;

function JdEditor({
  jd,
  ctx,
  onCacheSync,
  onEditing,
}: {
  jd: JobDetailJd | null;
  ctx: EditContext;
  onCacheSync: (state: 'ok' | 'error') => void;
  onEditing?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(() => jdDrafts.has(ctx.id));
  const [text, setText] = useState(() => jdDrafts.get(ctx.id) ?? jd?.text ?? '');
  const [restored] = useState(() => jdDrafts.has(ctx.id));
  const [base, setBase] = useState({ revision: jd?.revision ?? '0', hash: jd?.contentHash ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<JobDetailJd | null>(null);
  const [shelved, setShelved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const stored = jd?.text ?? '';
  const dirty = editing && text !== stored;
  const editButton = useReturnFocus(editing);
  useEffect(() => {
    onEditing?.(editing);
  }, [editing]);

  useEffect(() => {
    if (dirty) jdDrafts.set(ctx.id, text);
    else jdDrafts.delete(ctx.id);
  }, [dirty, text, ctx.id]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const clicks = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('#') && !href.startsWith('?') && !href.startsWith('/#')) return;
      if (
        !window.confirm(
          'You have unsaved changes to the job description. Leave this page? Your text is kept until you reload.',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', clicks, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', clicks, true);
    };
  }, [dirty]);

  const start = () => {
    setText(stored);
    setBase({ revision: jd?.revision ?? '0', hash: jd?.contentHash ?? '' });
    setError(null);
    setConflict(null);
    setShelved(null);
    setSaved(false);
    setEditing(true);
  };
  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to the job description?')) return;
    setEditing(false);
    setError(null);
    setConflict(null);
    setShelved(null);
  };
  const save = async () => {
    if (!text.trim()) {
      setError('The job description cannot be blank.');
      return;
    }
    if (new TextEncoder().encode(text).length > jdLimitBytes) {
      setError('The job description is larger than 2 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveJd(
        ctx.id,
        { expectedRevision: base.revision, expectedHash: base.hash, text },
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJd(result.data.job, result.data.jd);
      onCacheSync(result.data.cacheSync);
      setBase({ revision: result.data.jd.revision, hash: result.data.jd.contentHash });
      setEditing(false);
      setConflict(null);
      setShelved(null);
      setSaved(true);
    } catch (failure) {
      if (conflictCode(failure) === 'JD_CONFLICT') {
        const fresh = await ctx.refresh();
        if (fresh?.jd) {
          setConflict(fresh.jd);
          setBase({ revision: fresh.jd.revision, hash: fresh.jd.contentHash });
        } else {
          setError('The job description was changed elsewhere. Reload the page to see it.');
        }
      } else {
        setError(fieldErrors(failure).text ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!editing)
    return (
      <div className="edit-actions">
        <button className="quiet-button" ref={editButton} onClick={start} data-jd-edit>
          {jd ? 'Edit job description' : 'Add job description'}
        </button>
        {saved && (
          <span className="success-copy" role="status">
            Job description saved.
          </span>
        )}
      </div>
    );
  return (
    <div className="jd-editor">
      {restored && !saved && (
        <p className="pane-meta">Restored your unsaved changes from earlier in this session.</p>
      )}
      <label htmlFor="jd-text" className="visually-hidden">
        Job description text
      </label>
      <textarea
        id="jd-text"
        autoFocus
        className="doc-edit"
        value={text}
        spellCheck={false}
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'jd-error' : undefined}
        onChange={event => setText(event.target.value)}
      />
      {error && (
        <p className="field-error" id="jd-error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              The stored job description changed elsewhere (revision {conflict.revision}). Your text
              is kept in the box above and nothing was overwritten.
            </p>
            <details>
              <summary>Show the current stored text</summary>
              <pre className="doc-text conflict-text">{conflict.text}</pre>
            </details>
            <div className="edit-actions">
              {shelved === null ? (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setShelved(text);
                    setText(conflict.text);
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
          {busy ? 'Saving…' : conflict ? 'Save over current version' : 'Save job description'}
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
          Close editor
        </button>
        {dirty && <span className="pane-meta">Unsaved changes</span>}
      </div>
    </div>
  );
}

export function JdPaneEditable({
  jd,
  ctx,
  onCacheSync,
}: {
  jd: JobDetailJd | null;
  ctx: EditContext;
  onCacheSync: (state: 'ok' | 'error') => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {editing ? null : jd ? (
        <>
          <p className="pane-meta">Stored {formatDateTime(jd.syncedAt)}</p>
          <JdText text={jd.text} />
        </>
      ) : (
        <p className="missing-copy">No job description is stored for this job.</p>
      )}
      <JdEditor jd={jd} ctx={ctx} onCacheSync={onCacheSync} onEditing={setEditing} />
    </>
  );
}
