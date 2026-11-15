import { useEffect, useState } from 'react';
import type { ProviderKey, ProviderSettings } from '../api';

const OTHER_MODEL = '__other__';

// Switching provider keeps the model only when the new provider lists it; otherwise it falls back
// to that provider's first model.
export function modelAfterProviderChange(
  models: ProviderSettings['models'] | undefined,
  provider: ProviderKey,
  current: string,
) {
  const list: string[] = models?.[provider] ?? [];
  if (list.length === 0 || list.includes(current)) return current;
  return list[0];
}

// A dropdown of the provider's models plus "Other…", which reveals the free-text input. A value that
// is not in the list (a configured custom model) selects "Other…" and stays visible.
export function ModelField({
  id,
  provider,
  models,
  value,
  disabled,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  provider: ProviderKey;
  models: ProviderSettings['models'] | undefined;
  value: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  onChange: (model: string) => void;
}) {
  const list: string[] = models?.[provider] ?? [];
  const [forceOther, setForceOther] = useState(false);
  useEffect(() => setForceOther(false), [provider]);
  const other = forceOther || list.length === 0 || !list.includes(value);
  return (
    <>
      <label>
        Model
        <select
          id={`${id}-model-select`}
          value={other ? OTHER_MODEL : value}
          disabled={disabled}
          onChange={event => {
            if (event.target.value === OTHER_MODEL) {
              setForceOther(true);
            } else {
              setForceOther(false);
              onChange(event.target.value);
            }
          }}
        >
          {list.map(model => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
          <option value={OTHER_MODEL}>Other…</option>
        </select>
      </label>
      {other && (
        <label>
          Other model name
          <input
            id={`${id}-model`}
            type="text"
            value={value}
            maxLength={80}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={event => onChange(event.target.value)}
          />
        </label>
      )}
    </>
  );
}

export function validateModel(value: string): string | null {
  const model = value.trim();
  if (!model) return 'Enter a model name.';
  if (Array.from(model).length > 80) return 'Keep the model name to 80 characters or fewer.';
  if (/[\u0000-\u001f\u007f]/.test(value))
    return 'The model name cannot contain control characters.';
  return null;
}
