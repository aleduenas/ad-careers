import { useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  type ProviderFunctionSetting,
  type ProviderKey,
  type ProviderSettings,
} from '../../api';
import { api } from '../../lib/client';
import { providerLabels, functionRows } from '../../lib/providers';
import { modelAfterProviderChange, ModelField, validateModel } from '../../components/ModelField';

export function ProviderRow({
  row,
  stored,
  revision,
  models,
  nonce,
  onSaved,
  reload,
}: {
  row: (typeof functionRows)[number];
  stored: ProviderFunctionSetting;
  models: ProviderSettings['models'];
  revision: string;
  nonce: string | null;
  onSaved: (next: ProviderSettings) => void;
  reload: () => Promise<ProviderSettings | null>;
}) {
  const [provider, setProvider] = useState<ProviderKey>(stored.provider);
  const [model, setModel] = useState(stored.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ProviderFunctionSetting | null>(null);
  const [saved, setSaved] = useState(false);
  const lastStored = useRef(stored);
  const dirty = provider !== stored.provider || model.trim() !== stored.model;
  const id = `provider-${row.key}`;

  // Follow the stored value while the row has no unsaved input; never overwrite typed input.
  useEffect(() => {
    const previous = lastStored.current;
    const wasClean = provider === previous.provider && model === previous.model;
    lastStored.current = stored;
    if (wasClean) {
      setProvider(stored.provider);
      setModel(stored.model);
    }
  }, [stored.provider, stored.model]);

  const save = async () => {
    const invalid = validateModel(model);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!nonce) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.saveProvider(
        row.key,
        { expectedRevision: revision, provider, model: model.trim() },
        nonce,
        new AbortController().signal,
      );
      onSaved(result.data);
      setConflict(null);
      setSaved(true);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'SETTINGS_CONFLICT') {
        const fresh = await reload();
        setConflict(fresh ? fresh.functions[row.key] : null);
        if (!fresh)
          setError(
            'The settings changed elsewhere. Reload the page to see them. Your input is kept.',
          );
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError(
          'The local session is no longer valid, so nothing was saved. Reload the page and try again.',
        );
      } else {
        setError(
          failure instanceof ApiFailure && failure.fields?.model
            ? 'Check the model name.'
            : failure instanceof ApiFailure
              ? failure.message
              : 'The change could not be saved.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="provider-row">
      <div className="provider-row-head">
        <div>
          <h3>{row.label}</h3>
          <p className="pane-meta">{row.hint}</p>
        </div>
        <span className={stored.source === 'file' ? 'source-badge' : 'source-badge is-legacy'}>
          {stored.source === 'file' ? 'Saved setting' : 'From existing config, not saved yet'}
        </span>
      </div>
      <div className="provider-fields">
        <label>
          Provider
          <select
            id={`${id}-provider`}
            value={provider}
            disabled={busy || !nonce}
            onChange={event => {
              const next = event.target.value as ProviderKey;
              setProvider(next);
              setModel(modelAfterProviderChange(models, next, model));
              setSaved(false);
            }}
          >
            <option value="claude">Claude</option>
            <option value="codex">OpenAI</option>
          </select>
        </label>
        <ModelField
          id={id}
          provider={provider}
          models={models}
          value={model}
          disabled={busy || !nonce}
          invalid={Boolean(error)}
          describedBy={error ? `${id}-error` : undefined}
          onChange={next => {
            setModel(next);
            setSaved(false);
          }}
        />
        {nonce && (
          <button
            className="primary-button"
            disabled={busy || !dirty}
            aria-label={`Save ${row.label}`}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice notice-warn" role="alert">
          <div>
            <p>
              These settings changed elsewhere. Stored now:{' '}
              <strong>
                {providerLabels[conflict.provider]} / {conflict.model}
              </strong>
              . Your input is kept above.
            </p>
            <div className="edit-actions">
              <button
                className="quiet-button"
                onClick={() => {
                  setProvider(conflict.provider);
                  setModel(conflict.model);
                  setConflict(null);
                  setError(null);
                }}
              >
                Use stored value
              </button>
              <span className="pane-meta">Or choose Save to replace it with your input.</span>
            </div>
          </div>
        </div>
      )}
      {saved && !dirty && (
        <p className="success-copy" role="status">
          {row.label} saved.
        </p>
      )}
    </li>
  );
}
