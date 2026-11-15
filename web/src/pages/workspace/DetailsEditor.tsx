import { useState, type KeyboardEvent } from 'react';
import { conflictCode, type DetailJob, type MetadataRequest, type SalaryValue } from '../../api';
import { api } from '../../lib/client';
import { formatSalary } from '../../lib/format';
import type { EditContext } from './StatusControl';
import { writeErrorText, fieldErrors } from '../../lib/errors';
import { useReturnFocus } from '../../lib/hooks';

const textLimit = 300;

function validateText(field: 'company' | 'role' | 'url', raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'This cannot be empty.';
  if (Array.from(value).length > textLimit) return `Keep this to ${textLimit} characters or fewer.`;
  if (field === 'url') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return 'Use a link that starts with http:// or https://.';
      if (url.username || url.password) return 'Remove the username or password from the link.';
    } catch {
      return 'Enter a full link, for example https://example.com/job.';
    }
  }
  return null;
}

function TextFieldRow({
  label,
  field,
  job,
  ctx,
}: {
  label: string;
  field: 'company' | 'role' | 'url';
  job: DetailJob;
  ctx: EditContext;
}) {
  const stored = field === 'url' ? job.url : job[field];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [base, setBase] = useState<string | null>(stored);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ stored: string | null; inUse: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputId = `edit-${field}`;
  const editButton = useReturnFocus(editing);

  const start = () => {
    setDraft(stored ?? '');
    setBase(stored);
    setError(null);
    setConflict(null);
    setSaved(false);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
    setConflict(null);
  };
  const save = async () => {
    const invalid = validateText(field, draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: MetadataRequest =
        field === 'url'
          ? { field, expectedValue: base, value: draft.trim() }
          : { field, expectedValue: base ?? '', value: draft.trim() };
      const result = await api.changeMetadata(
        ctx.id,
        body,
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJob(result.data.job);
      void ctx.refresh();
      setEditing(false);
      setConflict(null);
      setSaved(true);
    } catch (failure) {
      const code = conflictCode(failure);
      if (code === 'FIELD_CONFLICT') {
        const fresh = await ctx.refresh();
        const now = fresh ? (field === 'url' ? fresh.job.url : fresh.job[field]) : null;
        setConflict({ stored: now, inUse: false });
        if (fresh) setBase(now);
      } else if (code === 'URL_IN_USE') {
        setConflict({ stored: stored, inUse: true });
      } else {
        setError(fieldErrors(failure).value ?? writeErrorText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <span className="edit-label">{label}</span>
        {!editing && (
          <button
            className="quiet-button"
            ref={editButton}
            aria-label={`Edit ${label.toLowerCase()}`}
            onClick={start}
          >
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        <p className={stored ? 'edit-value' : 'missing-copy'}>
          {stored || (field === 'url' ? 'No source link' : `${label} missing`)}
        </p>
      ) : (
        <>
          <label htmlFor={inputId} className="visually-hidden">
            {label}
          </label>
          <input
            id={inputId}
            autoFocus
            type={field === 'url' ? 'url' : 'text'}
            value={draft}
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (!busy) void save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (!busy) cancel();
              }
            }}
          />
          {error && (
            <p className="field-error" id={`${inputId}-error`} role="alert">
              {error}
            </p>
          )}
          {conflict && !conflict.inUse && (
            <div className="notice notice-warn" role="alert">
              <p>
                This {label.toLowerCase()} was changed elsewhere. Stored value now:{' '}
                <strong>{conflict.stored ?? 'empty'}</strong>. Your input is kept in the box above.
              </p>
            </div>
          )}
          {conflict?.inUse && (
            <div className="notice notice-warn" role="alert">
              <p>Another job already uses this link. Your input is kept; change it or cancel.</p>
            </div>
          )}
          <div className="edit-actions">
            <button className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : conflict && !conflict.inUse ? 'Save over stored value' : 'Save'}
            </button>
            <button className="quiet-button" disabled={busy} onClick={cancel}>
              {conflict && !conflict.inUse ? 'Use stored value' : 'Cancel'}
            </button>
          </div>
        </>
      )}
      {saved && !editing && (
        <p className="success-copy" role="status">
          {label} saved.
        </p>
      )}
    </div>
  );
}

const decimal = /^\d+(\.\d+)?$/;

function SalaryRow({ job, ctx }: { job: DetailJob; ctx: EditContext }) {
  const stored = job.salary;
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [clear, setClear] = useState(false);
  const [base, setBase] = useState<SalaryValue | null>(stored);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useReturnFocus(editing);

  const start = () => {
    setMin(stored?.min ?? '');
    setMax(stored?.max ?? '');
    setClear(false);
    setBase(stored ? { min: stored.min, max: stored.max } : null);
    setError(null);
    setConflict(null);
    setSaved(false);
    setEditing(true);
  };
  const salaryKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!busy) void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) {
        setEditing(false);
        setError(null);
        setConflict(null);
      }
    }
  };
  const save = async () => {
    let value: { min: string; max: string } | null = null;
    if (!clear) {
      const lo = min.trim();
      const hi = max.trim();
      if (!decimal.test(lo) || !decimal.test(hi)) {
        setError('Enter both amounts as plain numbers, for example 90000 and 120000.');
        return;
      }
      if (Number(lo) > Number(hi)) {
        setError('The lowest amount cannot be higher than the highest.');
        return;
      }
      value = { min: lo, max: hi };
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.changeMetadata(
        ctx.id,
        { field: 'salaryBand', expectedValue: base, value },
        ctx.nonce,
        new AbortController().signal,
      );
      ctx.applyJob(result.data.job);
      void ctx.refresh();
      setEditing(false);
      setConflict(null);
      setSaved(true);
    } catch (failure) {
      if (conflictCode(failure) === 'FIELD_CONFLICT') {
        const fresh = await ctx.refresh();
        const now = fresh?.job.salary ?? null;
        setConflict(now ? `${formatSalary(now) ?? 'a partial range'}` : 'no manual range');
        if (fresh) setBase(now ? { min: now.min, max: now.max } : null);
      } else {
        const fields = fieldErrors(failure);
        setError(
          fields.value ?? fields['value.min'] ?? fields['value.max'] ?? writeErrorText(failure),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="edit-field">
      <div className="edit-field-head">
        <span className="edit-label">Manual salary range</span>
        {!editing && (
          <button
            className="quiet-button"
            ref={editButton}
            aria-label="Edit salary range"
            onClick={start}
          >
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        <p className={stored ? 'edit-value' : 'missing-copy'}>
          {formatSalary(stored) ?? 'No manual range'}
        </p>
      ) : (
        <>
          <div className="edit-pair">
            <label>
              Lowest
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={min}
                disabled={busy || clear}
                aria-invalid={Boolean(error)}
                onChange={event => setMin(event.target.value)}
                onKeyDown={event => salaryKeys(event)}
              />
            </label>
            <label>
              Highest
              <input
                type="text"
                inputMode="decimal"
                value={max}
                disabled={busy || clear}
                aria-invalid={Boolean(error)}
                onChange={event => setMax(event.target.value)}
                onKeyDown={event => salaryKeys(event)}
              />
            </label>
          </div>
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={clear}
              disabled={busy}
              onChange={event => setClear(event.target.checked)}
            />{' '}
            Remove the manual range
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {conflict && (
            <div className="notice notice-warn" role="alert">
              <p>
                The range was changed elsewhere. Stored value now: <strong>{conflict}</strong>. Your
                input is kept above.
              </p>
            </div>
          )}
          <div className="edit-actions">
            <button className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : conflict ? 'Save over stored value' : 'Save'}
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError(null);
                setConflict(null);
              }}
            >
              {conflict ? 'Use stored value' : 'Cancel'}
            </button>
          </div>
        </>
      )}
      {saved && !editing && (
        <p className="success-copy" role="status">
          Salary range saved.
        </p>
      )}
    </div>
  );
}

export function DetailsEditor({ job, ctx }: { job: DetailJob; ctx: EditContext }) {
  return (
    <section className="edit-card" aria-labelledby="details-edit-title">
      <h3 id="details-edit-title">Edit details</h3>
      <div className="edit-grid">
        <TextFieldRow label="Company" field="company" job={job} ctx={ctx} />
        <TextFieldRow label="Role" field="role" job={job} ctx={ctx} />
        <TextFieldRow label="Source link" field="url" job={job} ctx={ctx} />
        <SalaryRow job={job} ctx={ctx} />
      </div>
    </section>
  );
}
