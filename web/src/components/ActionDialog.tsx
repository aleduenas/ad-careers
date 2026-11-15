import { useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  type EndpointState,
  type DetailJob,
  type JobActions,
  type RunSelection,
  type RunRecord,
  type ProviderFunctionName,
  type ProviderKey,
  type ProviderSettings,
} from '../api';
import { api } from '../lib/client';
import { actionButtons } from '../lib/jobActions';
import { functionLabel } from '../lib/runs';
import { isObject } from '../lib/errors';
import { providerLabels, readinessText } from '../lib/providers';
import { modelAfterProviderChange, ModelField, validateModel } from './ModelField';

export function ActionDialog({
  action,
  job,
  nonce,
  onClose,
  onStarted,
  onPrerequisite,
  onActive,
}: {
  action: (typeof actionButtons)[number];
  job: DetailJob;
  nonce: string;
  onClose: () => void;
  onStarted: (runs: RunRecord[]) => void;
  onPrerequisite: (actions: JobActions | null, reason: string) => void;
  onActive: (runId: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [settings, setSettings] = useState<EndpointState<ProviderSettings>>({ kind: 'loading' });
  const [overrides, setOverrides] = useState<
    Partial<Record<ProviderFunctionName, { on: boolean; provider: ProviderKey; model: string }>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});

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
      // Closing by unmounting must still hand focus back to the button that opened the dialog.
      dialog?.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const saved = (name: ProviderFunctionName) =>
    settings.kind === 'success' ? settings.value.functions[name] : null;
  const current = (name: ProviderFunctionName) => {
    const stored = saved(name);
    return (
      overrides[name] ?? {
        on: false,
        provider: stored?.provider ?? ('claude' as ProviderKey),
        model: stored?.model ?? '',
      }
    );
  };

  const start = async () => {
    const found: Record<string, string> = {};
    const selection: RunSelection = {};
    for (const name of action.functions) {
      const item = current(name);
      if (!item.on) continue;
      const invalid = validateModel(item.model);
      if (invalid) found[name] = invalid;
      else selection[name] = { provider: item.provider, model: item.model.trim() };
    }
    setProblems(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.startJobRun(
        {
          action: action.key,
          jobId: job.id,
          requestKey: `job-${action.key}-${job.id}-${crypto.randomUUID()}`,
          ...(Object.keys(selection).length ? { selection } : {}),
        },
        nonce,
        new AbortController().signal,
      );
      onStarted(result.data.runs);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'PREREQUISITE_FAILED') {
        const actions =
          isObject(failure.current) && isObject(failure.current.actions)
            ? (failure.current.actions as unknown as JobActions)
            : null;
        onPrerequisite(actions, actions?.[action.key]?.reason ?? failure.message);
      } else if (failure instanceof ApiFailure && failure.code === 'RUN_ACTIVE') {
        const id =
          isObject(failure.current) && typeof failure.current.activeRunId === 'string'
            ? failure.current.activeRunId
            : null;
        onActive(id);
      } else if (failure instanceof ApiFailure && failure.code === 'PROVIDER_UNAVAILABLE') {
        // The command line tool is missing: nothing was created, so the dialog stays open.
        setError(failure.message);
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError(
          'The local session is no longer valid, so nothing was started. Reload the page and try again.',
        );
      } else if (failure instanceof ApiFailure && failure.fields) {
        setError('The run was not accepted. Check the provider and model choices.');
      } else {
        setError(failure instanceof ApiFailure ? failure.message : 'The run could not be started.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      className="dialog action-dialog"
      ref={ref}
      aria-labelledby="action-dialog-title"
      aria-describedby="action-dialog-copy"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = controls.item(0);
        const last = controls.item(controls.length - 1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="action-dialog-title" tabIndex={-1}>
        {action.title}?
      </h2>
      <p className="dialog-copy" id="action-dialog-copy">
        {job.company || 'Company missing'} – {job.role || 'Role missing'} (job #{job.id}). This
        starts a background run on your subscription command line tool and can take several minutes.
        Your saved settings are not changed.
      </p>
      {settings.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading your provider settings…
        </p>
      )}
      {settings.kind === 'error' && (
        <div className="notice notice-warn" role="status">
          <p>
            Your saved provider settings could not be read ({settings.error.message}). The run will
            use whatever the server has saved. You can still choose a provider and model below.
          </p>
        </div>
      )}
      <ul className="action-functions">
        {action.functions.map(name => {
          const stored = saved(name);
          const item = current(name);
          return (
            <li key={name} className="action-function">
              <div>
                <strong>{functionLabel(name)}</strong>
                <span className="pane-meta">
                  {stored
                    ? `Saved: ${providerLabels[stored.provider]} / ${stored.model}`
                    : 'Saved choice not shown'}
                </span>
              </div>
              {settings.kind === 'success' &&
                (() => {
                  const state = settings.value.readiness[item.provider].state;
                  return (
                    <p className="action-readiness">
                      <span className={`readiness-badge readiness-${state}`}>
                        {providerLabels[item.provider]}: {readinessText[state]}
                      </span>
                      {(state === 'notLoggedIn' || state === 'unavailable') && (
                        <span className="field-error" role="status">
                          {state === 'notLoggedIn'
                            ? `${providerLabels[item.provider]} does not look signed in on this computer, so this run may fail.`
                            : `The ${item.provider} command could not be run, so this run may fail.`}{' '}
                          You can still start it.
                        </span>
                      )}
                    </p>
                  );
                })()}
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={item.on}
                  disabled={busy}
                  onChange={event =>
                    setOverrides(previous => ({
                      ...previous,
                      [name]: { ...item, on: event.target.checked },
                    }))
                  }
                />{' '}
                Use a different provider or model for this run only
              </label>
              {item.on && (
                <div className="provider-fields action-override">
                  <label>
                    Provider
                    <select
                      value={item.provider}
                      disabled={busy}
                      onChange={event => {
                        const next = event.target.value as ProviderKey;
                        setOverrides(previous => ({
                          ...previous,
                          [name]: {
                            ...item,
                            provider: next,
                            model: modelAfterProviderChange(
                              settings.kind === 'success' ? settings.value.models : undefined,
                              next,
                              item.model,
                            ),
                          },
                        }));
                      }}
                    >
                      <option value="claude">Claude</option>
                      <option value="codex">OpenAI</option>
                    </select>
                  </label>
                  <ModelField
                    id={`override-${name}`}
                    provider={item.provider}
                    models={settings.kind === 'success' ? settings.value.models : undefined}
                    value={item.model}
                    disabled={busy}
                    invalid={Boolean(problems[name])}
                    onChange={next =>
                      setOverrides(previous => ({
                        ...previous,
                        [name]: { ...item, model: next },
                      }))
                    }
                  />
                  {problems[name] && (
                    <p className="field-error" role="alert">
                      {problems[name]}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="edit-actions">
        <button className="primary-button" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start'}
        </button>
        <button className="quiet-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
