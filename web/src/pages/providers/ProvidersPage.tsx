import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type EndpointState, type ProviderSettings } from '../../api';
import { api } from '../../lib/client';
import { formatDateTime } from '../../lib/format';
import { providerLabels, loginCommands, functionRows, readinessText } from '../../lib/providers';
import { ProviderRow } from './ProviderRow';

export function ProvidersPage({ nonce }: { nonce: string | null }) {
  const [state, setState] = useState<EndpointState<ProviderSettings>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const reload = async (): Promise<ProviderSettings | null> => {
    try {
      const fresh = await api.providerSettings(new AbortController().signal);
      setState({ kind: 'success', value: fresh.data });
      return fresh.data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api.providerSettings(controller.signal).then(
      value => {
        if (!controller.signal.aborted) setState({ kind: 'success', value: value.data });
      },
      error => {
        if (!controller.signal.aborted)
          setState({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => controller.abort();
  }, [retry]);

  const checkLogins = async () => {
    if (!nonce) return;
    setChecking(true);
    setCheckError(null);
    try {
      const readiness = await api.checkProviderReadiness(nonce, new AbortController().signal);
      setState(previous =>
        previous.kind === 'success'
          ? { kind: 'success', value: { ...previous.value, readiness } }
          : previous,
      );
    } catch (failure) {
      setCheckError(
        failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED'
          ? 'The local session is no longer valid. Reload the page and try again.'
          : failure instanceof ApiFailure
            ? failure.message
            : 'The login check could not run.',
      );
    } finally {
      setChecking(false);
    }
  };

  // The login check is bounded and sends no prompt, so it runs once when the page opens.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (state.kind !== 'success' || !nonce || autoChecked.current) return;
    autoChecked.current = true;
    void checkLogins();
  }, [state.kind, nonce]);

  if (state.kind === 'loading')
    return (
      <section className="empty-state" role="status">
        <span className="spinner" aria-hidden="true" /> Loading provider settings…
      </section>
    );
  if (state.kind === 'error') {
    const unavailable = [
      'DATABASE_UNAVAILABLE',
      'SCHEMA_NOT_READY',
      'SETTINGS_UNAVAILABLE',
      'SETTINGS_UNREADABLE',
    ].includes(state.error.code);
    return (
      <div className={`notice ${unavailable ? 'notice-warn' : 'notice-error'}`} role="alert">
        <div>
          <strong>Provider settings could not be loaded.</strong>
          <p>{state.error.message}</p>
        </div>
        <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
          Retry
        </button>
      </div>
    );
  }
  const settings = state.value;
  return (
    <div className="providers-page">
      <section className="edit-card" aria-labelledby="provider-functions-title">
        <h2 id="provider-functions-title">Provider and model for each task</h2>
        <p className="pane-meta">
          Choose which subscription each task uses. Saving a row writes all four tasks to the
          settings file. A single run can still override these choices later.
        </p>
        <ul className="provider-list">
          {functionRows.map(row => (
            <ProviderRow
              key={row.key}
              row={row}
              stored={settings.functions[row.key]}
              models={settings.models}
              revision={settings.revision}
              nonce={nonce}
              reload={reload}
              onSaved={next =>
                setState(previous =>
                  previous.kind === 'success'
                    ? { kind: 'success', value: { ...previous.value, ...next } }
                    : previous,
                )
              }
            />
          ))}
        </ul>
        {!nonce && (
          <p className="missing-copy">Editing is unavailable until the local session loads.</p>
        )}
      </section>

      <section className="edit-card" aria-labelledby="readiness-title">
        <div className="section-heading">
          <div>
            <h2 id="readiness-title">Subscription logins</h2>
            <p className="pane-meta">
              The check asks each command line tool whether it is signed in. It does not send a
              prompt or use any credits.
            </p>
          </div>
          {nonce && (
            <button className="quiet-button" disabled={checking} onClick={() => void checkLogins()}>
              {checking ? 'Checking…' : 'Check logins'}
            </button>
          )}
        </div>
        {checkError && (
          <div className="notice notice-error" role="alert">
            <p>{checkError}</p>
          </div>
        )}
        <ul className="readiness-list" aria-live="polite">
          {(['claude', 'codex'] as const).map(key => {
            const item = settings.readiness[key];
            return (
              <li key={key} className="readiness-row">
                <div>
                  <h3>{providerLabels[key]}</h3>
                  <p className="pane-meta">
                    {item.checkedAt
                      ? `Checked ${formatDateTime(item.checkedAt)}`
                      : checking
                        ? 'Checking now…'
                        : 'Use Check logins to test it.'}
                  </p>
                </div>
                <span className={`readiness-badge readiness-${item.state}`}>
                  {readinessText[item.state]}
                </span>
                {item.message && <p className="readiness-message">{item.message}</p>}
                {item.state !== 'ready' && (
                  <p className="readiness-help">
                    {item.state === 'unavailable'
                      ? `The ${key} command could not be run. Check that it is installed on this computer. `
                      : ''}
                    To sign in, run <code>{loginCommands[key]}</code> in a terminal on this
                    computer, then choose Check logins. This page never asks for a password or
                    token.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
