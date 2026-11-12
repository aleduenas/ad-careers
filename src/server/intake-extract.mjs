import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  processRun as defaultProcessRun,
  cliSpec,
  temporaryWorker as defaultWorker,
} from '../lib/cli-runtime.mjs';
import { renderPrompt } from '../lib/_prompt-templates.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { PROVIDERS, validModel } from './providers.mjs';

// URL intake extraction (package 4.6). One isolated subscription-CLI call that cleans a fetched
// posting: company, role, location and the posting text with page chrome removed. The call goes
// through src/lib/cli-runtime.mjs exactly like the launchers (cliSpec, processRun, temporary
// worker directory) with the versioned prompt llm/prompts/intake/extract-posting.md. The posting
// text travels on stdin only, never in argv, and is never logged. The result is validated; when
// it is not usable the caller keeps the fetched text and adds a warning.
//
// Provider and model: functions.intake in config/llm-providers.json when it is valid, otherwise
// claude / haiku. Commands come from config/cv-drafting.json like the other launchers.

export const DEFAULT_INTAKE_FUNCTION = Object.freeze({ provider: 'claude', model: 'haiku' });
export const MAX_INPUT_CHARS = 300_000;
export const MIN_DESCRIPTION_CHARS = 400;
export const MIN_DESCRIPTION_SHARE = 0.4;
const TIMEOUT_MS = 90_000;
const MAX_FIELD = 300;

export const WARNINGS = Object.freeze({
  discarded: 'Model extraction was discarded; text kept as fetched.',
  failed: 'Model extraction failed; text kept as fetched.',
  tooLong: 'Posting too long for model extraction; text kept as fetched.',
});

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

export function intakeFunction(rootDir, readConfig = readJson) {
  const entry = readConfig(join(rootDir, 'config', 'llm-providers.json'))?.functions?.intake;
  if (entry && PROVIDERS.includes(entry.provider) && validModel(entry.model))
    return { provider: entry.provider, model: entry.model.trim() };
  return { ...DEFAULT_INTAKE_FUNCTION };
}

// Verbatim check. Both texts lose markdown markers and link/image syntax (down to their text),
// collapse whitespace and lower-case; the description is split into lines (long lines into
// sentences) and at least MIN_VERBATIM_SHARE of its characters must occur as substrings of the
// input. A reworded, summarized or invented description fails.
const MIN_VERBATIM_SHARE = 0.95;
const LONG_LINE = 300;
const normalize = value =>
  String(value)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function verbatimShare(description, input) {
  const haystack = normalize(input);
  let total = 0;
  let matched = 0;
  for (const line of description.split(/\n/)) {
    const units = line.length > LONG_LINE ? line.split(/(?<=[.!?])\s+/) : [line];
    for (const unit of units) {
      const text = normalize(unit);
      if (!text) continue;
      total += text.length;
      if (haystack.includes(text)) matched += text.length;
    }
  }
  return total === 0 ? 0 : matched / total;
}

const field = value => {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('field is not a string or null');
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? [...text].slice(0, MAX_FIELD).join('') : null;
};

// Validates the model's answer against the input; returns the fields and description or throws.
export function validateExtraction(answer, input) {
  const raw = JSON.parse(
    String(answer)
      .trim()
      .replace(/^```(?:json)?\s*|\s*```$/g, ''),
  );
  const keys = ['company', 'role', 'location', 'description'];
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== keys.length ||
    !keys.every(key => Object.hasOwn(raw, key))
  )
    throw new Error('wrong shape');
  if (typeof raw.description !== 'string') throw new Error('description is not a string');
  const description = raw.description.replace(/\u0000/g, '').trim();
  if (
    description.length < MIN_DESCRIPTION_CHARS ||
    description.length < input.length * MIN_DESCRIPTION_SHARE ||
    description.length > input.length
  )
    throw new Error('description length out of range');
  if (verbatimShare(description, input) < MIN_VERBATIM_SHARE)
    throw new Error('description is not verbatim');
  return {
    company: field(raw.company),
    role: field(raw.role),
    location: field(raw.location),
    description,
    note: `Cleaned by model: kept ${description.length} of ${input.length} characters.`,
  };
}

export function createIntakeExtractor({
  rootDir = repositoryRoot,
  readConfig = readJson,
  processRun = defaultProcessRun,
  temporaryWorker = defaultWorker,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  // extract(text) -> { ok: true, company, role, location, description } | { ok: false, warning }.
  // It never throws and never returns provider output on failure.
  async function extract(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, warning: WARNINGS.failed };
    if (text.length > MAX_INPUT_CHARS) return { ok: false, warning: WARNINGS.tooLong };
    let answer;
    try {
      const { provider, model } = intakeFunction(rootDir, readConfig);
      const drafting = readConfig(join(rootDir, 'config', 'cv-drafting.json')) ?? {};
      const config = {
        claude_command: drafting.claude_command || 'claude',
        codex_command: drafting.codex_command || 'codex',
        [`${provider}_model`]: model,
      };
      const prompt = renderPrompt(rootDir, 'intake/extract-posting.md', { POSTING_TEXT: text });
      answer = await temporaryWorker(rootDir, async cwd => {
        const response = join(cwd, 'response.txt');
        const spec = cliSpec(provider, config, response);
        if (provider === 'codex') spec.args.splice(1, 0, '--json');
        const result = await processRun(spec.command, spec.args, {
          cwd,
          input: prompt,
          timeout: timeoutMs,
          usage: { provider, model, fn: 'intake', jobId: null },
        });
        if (result.code !== 0) throw new Error('CLI failed');
        if (provider === 'codex') {
          if (!existsSync(response)) throw new Error('CLI returned no response');
          return readFileSync(response, 'utf8');
        }
        const envelope = JSON.parse(result.stdout);
        if (envelope.is_error || typeof envelope.result !== 'string')
          throw new Error('CLI returned an error');
        return envelope.result;
      });
    } catch {
      return { ok: false, warning: WARNINGS.failed };
    }
    try {
      return { ok: true, ...validateExtraction(answer, text) };
    } catch {
      return { ok: false, warning: WARNINGS.discarded };
    }
  }
  return Object.freeze({ extract });
}
