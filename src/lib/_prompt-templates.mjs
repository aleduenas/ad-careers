import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function renderPrompt(root, name, values = {}) {
  if (!/^[a-z0-9][a-z0-9/-]*\.md$/i.test(name) || name.includes('..'))
    throw new Error('Invalid prompt template name: ' + name);
  let text = readFileSync(join(resolve(root), 'llm', 'prompts', name), 'utf8')
    .replaceAll('\r\n', '\n')
    .trimEnd();
  text = text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (raw, key) => {
    if (!Object.hasOwn(values, key))
      throw new Error('Missing prompt value ' + key + ' for ' + name);
    return String(values[key] ?? '');
  });
  // Values are literal evidence, not another template. Required source keys
  // were checked above; placeholder-looking text inside values stays unchanged.
  return text + '\n';
}

// The worksheet a rendered prompt asks the model to fill is a literal JSON
// object written directly into the prompt file, between these markers —
// exactly like llm/prompts/cvgen/cv-worksheet.md. The prompt file is always the single
// source of truth for the worksheet's shape; the script only reads it back.
export function extractWorksheetJSON(text) {
  const start = '<!-- WORKSHEET_JSON_START -->',
    end = '<!-- WORKSHEET_JSON_END -->';
  const a = text.indexOf(start),
    b = text.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error('Worksheet JSON markers are missing or malformed');
  return JSON.parse(text.slice(a + start.length, b).trim());
}

// Recursively checks that a model's JSON answer preserves the worksheet's
// key structure. Objects must match keys and key order exactly. Arrays are
// checked against the template's first element's shape only — the model may
// return fewer or more entries within whatever limit the decode step
// enforces (e.g. target 1-10 requirement rows with a small validation
// tolerance, and target 15-20 keywords with the same tolerance).
export function sameShape(value, template) {
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return false;
    return template.length === 0 || value.every(v => sameShape(v, template[0]));
  }
  if (template && typeof template === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const vKeys = Object.keys(value),
      tKeys = Object.keys(template);
    return (
      vKeys.length === tKeys.length &&
      tKeys.every((k, i) => vKeys[i] === k) &&
      tKeys.every(k => sameShape(value[k], template[k]))
    );
  }
  return typeof value === 'string' || typeof value === 'number';
}
