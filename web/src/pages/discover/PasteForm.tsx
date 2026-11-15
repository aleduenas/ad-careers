import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ApiFailure,
  type IntakeCheck,
  type IntakeInput,
  type IntakePreview,
  type IntakeResult,
} from '../../api';
import { api } from '../../lib/client';
import { activeRunId, isObject } from '../../lib/errors';

const MIN_JD_CHARS = 100;

/** Fill a field from a fetch only when it is empty or still holds the last fetched value. */

function fillFetched(current: string, last: string | null, next: string | null): string {
  if (next === null || next === '') return current;
  return current.trim() === '' || current === last ? next : current;
}

/** Prepend a `Location: …` line when the fetched text does not already mention the location. */

function withLocation(text: string, location: string | null): string {
  const place = location?.trim();
  if (!place || text.toLowerCase().includes(place.toLowerCase())) return text;
  return `Location: ${place}

${text}`;
}

const intakeFieldMessages: Record<string, string> = {
  url: 'Enter a full http or https link.',
  company: 'Check the company name.',
  role: 'Check the role title.',
  text: 'The description was not accepted. Check that it is long enough and complete.',
};

// The server only says "Invalid value." per field, so show a plain message for each known field.
function intakeFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiFailure) || !error.fields) return {};
  return Object.fromEntries(
    Object.keys(error.fields).map(key => [key, intakeFieldMessages[key] ?? 'Check this value.']),
  );
}

/** DISCOVERY_BUSY carries current.activeRunId (null when another intake holds the lock). */

function trackedJob(error: unknown): IntakeCheck['tracked'] {
  if (!(error instanceof ApiFailure) || !isObject(error.current)) return null;
  const tracked = error.current.tracked;
  return isObject(tracked) && typeof tracked.id === 'string'
    ? (tracked as NonNullable<IntakeCheck['tracked']>)
    : null;
}

function useTrackedStatusLine(job: NonNullable<IntakeCheck['tracked']>) {
  const [line, setLine] = useState(job.status);
  useEffect(() => {
    setLine(job.status);
    if (job.status !== 'Discarded') return;
    const controller = new AbortController();
    api.jobDetail(job.id, controller.signal).then(
      result => {
        if (controller.signal.aborted) return;
        const latest = [...result.data.history]
          .filter(entry => entry.newStatus === 'Discarded')
          .sort((a, b) =>
            (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt),
          )[0];
        if (!latest) return;
        const when = new Date(latest.occurredAt ?? latest.createdAt);
        const date = Number.isNaN(when.getTime())
          ? ''
          : ` on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(when)}`;
        setLine(`Discarded${date}${latest.reason ? `: ${latest.reason}` : ''}`);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [job.id, job.status]);
  return line;
}

function TrackedNotice({
  job,
  children,
}: {
  job: NonNullable<IntakeCheck['tracked']>;
  children?: ReactNode;
}) {
  const line = useTrackedStatusLine(job);
  return (
    <div className="notice notice-warn" role="alert">
      <p>
        This posting is already tracked as job #{job.id} ({line}). Open it to change its status.{' '}
        <a className="in-page-link" href={`#/jobs/${job.id}`}>
          Open that job ({job.company} – {job.role})
        </a>
        {children}
      </p>
    </div>
  );
}

export function PasteForm({ nonce, onAdded }: { nonce: string; onAdded?: () => void }) {
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<
    { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; result: IntakeCheck }
  >({ kind: 'idle' });
  const [force, setForce] = useState(false);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ key: string; data: IntakePreview } | null>(null);
  const [busy, setBusy] = useState<'check' | 'fetch' | 'preview' | 'add' | null>(null);
  const [fetchWarnings, setFetchWarnings] = useState<string[]>([]);
  const [fetchAfterConfirm, setFetchAfterConfirm] = useState(false);
  const lastFetched = useRef<{ company: string | null; role: string | null; text: string | null }>({
    company: null,
    role: null,
    text: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ job: IntakeCheck['tracked'] } | null>(null);
  const [seenPrompt, setSeenPrompt] = useState(false);
  const [busyRun, setBusyRun] = useState<string | null | undefined>(undefined);
  const [added, setAdded] = useState<IntakeResult | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  const tracked = check.kind === 'done' ? check.result.tracked : null;
  const seen = check.kind === 'done' ? check.result.seen : null;
  const needsConfirm = (seen !== null && !force) || seenPrompt;
  // A scan-only link found by the check asks first; one the server reports later keeps the form
  // (and what was typed) on screen while the confirmation is shown.
  const open = check.kind === 'done' && !tracked && !duplicate && !(seen !== null && !force);
  const inputKey = JSON.stringify([url.trim(), company.trim(), role.trim(), text, force]);

  // Suggestions follow the company field, as the TUI does (1 to 100 characters).
  useEffect(() => {
    const value = company.trim();
    if (!open || !value || value.length > 100) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.intakeCompanies(value, controller.signal).then(
        result => {
          if (!controller.signal.aborted) setSuggestions(result.data.companies.slice(0, 10));
        },
        () => {
          if (!controller.signal.aborted) setSuggestions([]);
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [company, open]);

  const resetCheck = () => {
    setCheck({ kind: 'idle' });
    setForce(false);
    setSeenPrompt(false);
    setDuplicate(null);
    setPreview(null);
    setBusyRun(undefined);
    setNotice(null);
    setFetchAfterConfirm(false);
  };

  const handleFailure = (failure: unknown) => {
    setPreview(null);
    if (failure instanceof ApiFailure && failure.code === 'DUPLICATE_JOB') {
      setDuplicate({ job: trackedJob(failure) });
      setNotice(null);
    } else if (failure instanceof ApiFailure && failure.code === 'SEEN_URL') {
      setSeenPrompt(true);
      setNotice(null);
    } else if (failure instanceof ApiFailure && failure.code === 'DISCOVERY_BUSY') {
      setBusyRun(activeRunId(failure));
      setNotice(null);
    } else {
      const fields = intakeFieldErrors(failure);
      setErrors(fields);
      setNotice(
        failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED'
          ? 'The local session is no longer valid. Reload the page and try again. Nothing was added.'
          : failure instanceof ApiFailure
            ? failure.message
            : 'The request failed.',
      );
    }
  };

  const runCheck = async () => {
    const value = url.trim();
    if (!value) {
      setErrors({ url: 'Paste the job posting link first.' });
      return;
    }
    setErrors({});
    resetCheck();
    setBusy('check');
    try {
      const result = await api.intakeCheck(value, nonce, new AbortController().signal);
      setCheck({ kind: 'done', result: result.data });
    } catch (failure) {
      setCheck({ kind: 'idle' });
      handleFailure(failure);
    } finally {
      setBusy(null);
    }
  };

  // Read the page and fill the form. Only empty fields, or fields still holding the previous
  // fetched value, are filled; a refusal shows under the link and the form stays editable.
  const fetchFields = async (value: string) => {
    setBusy('fetch');
    setFetchWarnings([]);
    try {
      const fetched = (await api.intakeFetch(value, nonce, new AbortController().signal)).data;
      const nextText = fetched.text === null ? null : withLocation(fetched.text, fetched.location);
      const last = lastFetched.current;
      setCompany(current => fillFetched(current, last.company, fetched.company));
      setRole(current => fillFetched(current, last.role, fetched.role));
      setText(current => fillFetched(current, last.text, nextText));
      lastFetched.current = {
        company: fetched.company ?? last.company,
        role: fetched.role ?? last.role,
        text: nextText ?? last.text,
      };
      setFetchWarnings(fetched.warnings);
    } catch (failure) {
      setErrors({
        url:
          failure instanceof ApiFailure
            ? failure.code === 'LOCAL_REQUEST_REJECTED'
              ? 'The local session is no longer valid. Reload the page and try again.'
              : failure.message
            : 'The fetch failed. Fill the fields by hand.',
      });
    } finally {
      setBusy(null);
    }
  };

  // Fetch: the duplicate check runs first. A tracked or scan-seen link shows its result and is not
  // fetched; a seen link is fetched only after the owner chooses "Add it anyway".
  const runFetch = async () => {
    const value = url.trim();
    if (!value) {
      setErrors({ url: 'Paste the job posting link first.' });
      return;
    }
    setErrors({});
    resetCheck();
    setFetchWarnings([]);
    setFetchAfterConfirm(false);
    setBusy('fetch');
    try {
      const checked = await api.intakeCheck(value, nonce, new AbortController().signal);
      setCheck({ kind: 'done', result: checked.data });
      if (checked.data.tracked) return;
      if (checked.data.seen) {
        setFetchAfterConfirm(true);
        return;
      }
    } catch (failure) {
      setCheck({ kind: 'idle' });
      handleFailure(failure);
      return;
    } finally {
      setBusy(null);
    }
    await fetchFields(value);
  };

  const validate = () => {
    const found: Record<string, string> = {};
    if (!company.trim()) found.company = 'Enter the company name.';
    if (!role.trim()) found.role = 'Enter the role title.';
    if (text.trim().length < MIN_JD_CHARS)
      found.text = `The job description needs at least ${MIN_JD_CHARS} characters (it has ${text.trim().length}).`;
    return found;
  };

  const body = (): IntakeInput => ({
    url: url.trim(),
    company: company.trim(),
    role: role.trim(),
    text,
    force,
  });

  const runPreview = async () => {
    const found = validate();
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy('preview');
    try {
      const result = await api.intakePreview(body(), nonce, new AbortController().signal);
      setPreview({ key: inputKey, data: result.data });
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(null);
    }
  };

  const runAdd = async () => {
    const found = validate();
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy('add');
    try {
      const result = await api.intake(body(), nonce, new AbortController().signal);
      setAdded(result.data);
      onAdded?.();
      setUrl('');
      setCompany('');
      setRole('');
      setText('');
      resetCheck();
      setErrors({});
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(null);
    }
  };

  const previewReady = preview !== null && preview.key === inputKey;
  const fieldsValid = Object.keys(validate()).length === 0;
  const err = (key: string) => errors[key];

  return (
    <section className="edit-card discover-card" aria-labelledby="paste-title">
      <h3 id="paste-title">Add a job from a pasted description</h3>
      <p className="pane-meta">
        Paste the posting link and press Fetch to fill the company, role and description, or check
        the link and paste them yourself. Review everything before adding. Nothing is rewritten or
        scored.
      </p>
      {added && (
        <div className="notice notice-ok" role="status">
          <p>
            Added job #{added.id}: {added.company} – {added.role}.{' '}
            <a className="in-page-link" href={`#/jobs/${added.id}`}>
              Open the job workspace
            </a>
          </p>
        </div>
      )}

      <div className="paste-step">
        <label htmlFor="paste-url">Posting link</label>
        <div className="url-row">
          <input
            id="paste-url"
            type="url"
            ref={urlRef}
            value={url}
            disabled={busy !== null}
            placeholder="https://…"
            aria-invalid={Boolean(err('url'))}
            aria-describedby={err('url') ? 'paste-url-error' : undefined}
            onChange={event => {
              setUrl(event.target.value);
              if (check.kind !== 'idle' || duplicate || seenPrompt) resetCheck();
              setAdded(null);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runFetch();
              }
            }}
          />
          <button
            className="primary-button"
            disabled={busy !== null || !url.trim()}
            onClick={() => void runFetch()}
          >
            {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {err('url') && (
          <p className="field-error" id="paste-url-error" role="alert">
            {err('url')}
          </p>
        )}
        {fetchWarnings.length > 0 && <p className="pane-meta">{fetchWarnings.join(' ')}</p>}
        <div className="edit-actions">
          <button
            className="quiet-button"
            disabled={busy !== null || !url.trim()}
            onClick={() => void runCheck()}
          >
            {busy === 'check' ? 'Checking…' : 'Check link'}
          </button>
        </div>
      </div>

      {tracked && <TrackedNotice job={tracked} />}
      {duplicate && !tracked && duplicate.job && (
        <TrackedNotice job={duplicate.job}>
          {' '}
          Your text is kept; change the link to continue.
        </TrackedNotice>
      )}
      {duplicate && !tracked && !duplicate.job && (
        <div className="notice notice-warn" role="alert">
          <p>
            This link is already a tracked job and cannot be added again. Your text is kept; change
            the link to continue.
          </p>
        </div>
      )}
      {needsConfirm && !tracked && !duplicate && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              {seen
                ? `This link was seen in a scan: ${seen.company} – ${seen.title} (${seen.status}), first seen ${seen.firstSeen}. It is not a tracked job yet.`
                : 'This link was seen in an earlier scan but is not a tracked job.'}{' '}
              Add it anyway?
            </p>
            <div className="edit-actions">
              <button
                className="primary-button"
                onClick={() => {
                  setForce(true);
                  setSeenPrompt(false);
                  if (fetchAfterConfirm) {
                    setFetchAfterConfirm(false);
                    void fetchFields(url.trim());
                  }
                }}
              >
                Add it anyway
              </button>
              <button className="quiet-button" onClick={resetCheck}>
                Use a different link
              </button>
            </div>
          </div>
        </div>
      )}
      {check.kind === 'done' && check.result.url && check.result.url !== url.trim() && (
        <p className="pane-meta">Link as it will be stored: {check.result.url}</p>
      )}

      {open && (
        <div className="paste-step">
          <label>
            Company
            <input
              type="text"
              list="company-suggestions"
              value={company}
              disabled={busy !== null}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(err('company'))}
              aria-describedby={err('company') ? 'paste-company-error' : undefined}
              onChange={event => {
                setCompany(event.target.value);
              }}
            />
          </label>
          <datalist id="company-suggestions">
            {suggestions.map(name => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {err('company') && (
            <p className="field-error" id="paste-company-error" role="alert">
              {err('company')}
            </p>
          )}
          <label>
            Role
            <input
              type="text"
              value={role}
              disabled={busy !== null}
              aria-invalid={Boolean(err('role'))}
              aria-describedby={err('role') ? 'paste-role-error' : undefined}
              onChange={event => {
                setRole(event.target.value);
              }}
            />
          </label>
          {err('role') && (
            <p className="field-error" id="paste-role-error" role="alert">
              {err('role')}
            </p>
          )}
          <label>
            Job description (kept exactly as pasted)
            <textarea
              className="doc-edit"
              value={text}
              spellCheck={false}
              disabled={busy !== null}
              aria-invalid={Boolean(err('text'))}
              aria-describedby="paste-text-count"
              onChange={event => {
                setText(event.target.value);
              }}
            />
          </label>
          <p
            className={err('text') ? 'field-error' : 'pane-meta'}
            id="paste-text-count"
            role={err('text') ? 'alert' : undefined}
          >
            {err('text') ?? `${text.trim().length} of ${MIN_JD_CHARS} characters minimum`}
          </p>
          {previewReady && preview && (
            <div className="notice notice-ok" role="status">
              <p>
                Preview: <strong>{preview.data.company}</strong> – {preview.data.role}. The
                description would be stored as {preview.data.jdPath}. Nothing has been saved yet.
              </p>
            </div>
          )}
          <div className="edit-actions">
            <button
              className="primary-button"
              disabled={busy !== null || seenPrompt || !fieldsValid}
              onClick={() => void runAdd()}
            >
              {busy === 'add' ? 'Adding…' : 'Add job'}
            </button>
            <button
              className="quiet-button"
              disabled={busy !== null || seenPrompt || !fieldsValid}
              onClick={() => void runPreview()}
            >
              {busy === 'preview' ? 'Checking…' : 'Preview (optional)'}
            </button>
          </div>
        </div>
      )}
      {busyRun !== undefined && (
        <div className="notice notice-warn" role="alert">
          <p>
            A scan or another intake is already running, so nothing was added. Your input is kept.
            {busyRun ? ` Active scan: ${busyRun}.` : ' Another intake is in progress.'} Try again
            when it finishes.
          </p>
        </div>
      )}
      {notice && (
        <div className="notice notice-error" role="alert">
          <p>{notice}</p>
        </div>
      )}
    </section>
  );
}
