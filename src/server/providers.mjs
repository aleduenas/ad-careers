import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkLogin as defaultCheckLogin,
  temporaryWorker as defaultWorker,
} from '../lib/cli-runtime.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';

// Subscription provider settings (STAGE3_PROVIDERS_CONTRACT.md). One private settings file,
// config/llm-providers.json (version 1), names a provider and model for each of the four LLM
// functions. Without it the effective values are derived read-only from the existing launcher
// configs and reported as source "legacy". Saving rewrites the whole file atomically under an
// in-process lock with a revision check; readiness uses the existing login check only and never
// calls a model.

export const FUNCTIONS = Object.freeze(['evaluation', 'companyResearch', 'cv', 'coverLetter']);
export const PROVIDERS = Object.freeze(['claude', 'codex']);
const SETTINGS_FILE = ['config', 'llm-providers.json'];
const REVISION_PATTERN = /^(legacy|[0-9a-f]{64})$/;
const MAX_MODEL = 80;
const CHECK_TIMEOUT_MS = 20_000;
const MAX_SETTINGS_BYTES = 64 * 1024;

// The defaults the launchers use when their config file omits a value.
const EVAL_DEFAULTS = {
  default_provider: 'claude',
  claude_model: 'sonnet',
  claude_research_model: 'haiku',
  codex_model: 'gpt-6.1-sol',
  codex_research_model: 'gpt-6-luna',
};
// D066: model ids offered per provider. config/llm-providers.json may carry an optional
// `models` object that replaces a provider's list when it is a valid non-empty array.
export const DEFAULT_MODELS = Object.freeze({
  claude: Object.freeze(['sonnet', 'opus', 'haiku']),
  codex: Object.freeze(['gpt-6.1-sol', 'gpt-6-luna']),
});
const MAX_MODEL_LIST = 50;
const CV_FALLBACK = { claude: 'sonnet', codex: 'gpt-6.1-sol' };

function publicError(statusCode, publicCode, message, fields, current) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  if (fields) error.fields = fields;
  if (current !== undefined) error.current = current;
  return error;
}

const invalid = (field, message = 'Request field is invalid.') =>
  publicError(400, 'INVALID_REQUEST', message, { [field]: 'Invalid value.' });
const unreadable = () =>
  publicError(
    503,
    'SETTINGS_UNREADABLE',
    'config/llm-providers.json could not be read. Fix or remove it, then reload.',
  );

export function validModel(value) {
  // eslint-disable-next-line no-control-regex
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    [...value].length <= MAX_MODEL &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

async function readJson(fs, path) {
  try {
    const text = await fs.readFile(path, 'utf8');
    // Editors on Windows may save a UTF-8 byte-order mark; JSON.parse rejects it. The raw text
    // (BOM included) stays the revision source so the revision matches the bytes on disk.
    return { text, value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { text: null, value: null };
    return { text: null, value: undefined, broken: true };
  }
}

function pick(object, key) {
  return object && typeof object === 'object' && !Array.isArray(object) ? object[key] : undefined;
}

// Read-only effective defaults from today's launcher configs, in the launchers' own precedence.
export function deriveLegacy({ evaluationConfig, cvConfig }) {
  const evalProvider = PROVIDERS.includes(pick(evaluationConfig, 'default_provider'))
    ? evaluationConfig.default_provider
    : EVAL_DEFAULTS.default_provider;
  const text = (source, key, fallback) => {
    const value = pick(source, key);
    return validModel(value) ? value.trim() : fallback;
  };
  const cvProvider = PROVIDERS.includes(pick(cvConfig, 'default_provider'))
    ? cvConfig.default_provider
    : 'claude';
  const cvModel = text(cvConfig, cvProvider + '_model', CV_FALLBACK[cvProvider]);
  return {
    evaluation: {
      provider: evalProvider,
      model: text(
        evaluationConfig,
        evalProvider + '_model',
        EVAL_DEFAULTS[evalProvider + '_model'],
      ),
    },
    companyResearch: {
      provider: evalProvider,
      model: text(
        evaluationConfig,
        evalProvider + '_research_model',
        EVAL_DEFAULTS[evalProvider + '_research_model'],
      ),
    },
    cv: { provider: cvProvider, model: cvModel },
    coverLetter: { provider: cvProvider, model: cvModel },
  };
}

function validateDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1)
    return null;
  const functions = value.functions;
  if (!functions || typeof functions !== 'object' || Array.isArray(functions)) return null;
  const out = {};
  for (const name of FUNCTIONS) {
    const entry = functions[name];
    if (!entry || !PROVIDERS.includes(entry.provider) || !validModel(entry.model)) return null;
    out[name] = { provider: entry.provider, model: entry.model.trim() };
  }
  return out;
}

function effectiveModels(raw) {
  const out = {};
  for (const provider of PROVIDERS) {
    const list = pick(raw, provider);
    out[provider] =
      Array.isArray(list) &&
      list.length >= 1 &&
      list.length <= MAX_MODEL_LIST &&
      list.every(validModel)
        ? [...new Set(list.map(item => item.trim()))]
        : [...DEFAULT_MODELS[provider]];
  }
  return out;
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
const iso = value => (value instanceof Date ? value.toISOString() : null);

// Fixed, credential-free messages for each readiness outcome.
const MESSAGES = {
  ready: null,
  unavailable: provider => `The ${provider} command could not be run. Check that it is installed.`,
  timeout: 'The login check took too long. Try again.',
};

export function classifyLoginFailure(error) {
  const message = String(error?.message ?? '');
  if (
    /login required|Run claude auth login|Run codex login|Cannot read Claude login status/i.test(
      message,
    )
  )
    return { state: 'notLoggedIn', message: message.slice(0, 200) };
  return { state: 'unavailable', message: null };
}

export function createProvidersService({
  rootDir = repositoryRoot,
  fs = nodeFs,
  checkLogin = defaultCheckLogin,
  temporaryWorker = defaultWorker,
  now = () => new Date(),
  checkTimeoutMs = CHECK_TIMEOUT_MS,
} = {}) {
  for (const adapter of [checkLogin, temporaryWorker, now])
    if (typeof adapter !== 'function') throw new TypeError('Provider adapters must be functions.');
  const settingsPath = join(rootDir, ...SETTINGS_FILE);
  const readiness = Object.fromEntries(
    PROVIDERS.map(provider => [provider, { state: 'unknown', checkedAt: null, message: null }]),
  );
  let queue = Promise.resolve();
  let checking = null;

  // Serializes writes (and reads that must see them) inside this process.
  const locked = callback => {
    const run = queue.then(callback, callback);
    queue = run.catch(() => {});
    return run;
  };

  async function launcherConfig(name) {
    const { value } = await readJson(fs, join(rootDir, 'config', name));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  async function current() {
    const file = await readJson(fs, settingsPath);
    if (file.text === null && !file.broken) {
      const functions = deriveLegacy({
        evaluationConfig: await launcherConfig('evaluation-cli.json'),
        cvConfig: await launcherConfig('cv-drafting.json'),
      });
      return { functions, source: 'legacy', revision: 'legacy', models: effectiveModels() };
    }
    if (file.broken || Buffer.byteLength(file.text, 'utf8') > MAX_SETTINGS_BYTES)
      throw unreadable();
    const functions = validateDocument(file.value);
    if (!functions) throw unreadable();
    const rawModels = pick(file.value, 'models');
    return {
      functions,
      source: 'file',
      revision: sha256(file.text),
      // Optional extra function read by URL intake (src/server/intake-extract.mjs); it has no
      // settings UI, so saves carry it through untouched.
      rawIntake: file.value.functions.intake,
      rawModels,
      models: effectiveModels(rawModels),
    };
  }

  const document = state => ({
    functions: Object.fromEntries(
      FUNCTIONS.map(name => [name, { ...state.functions[name], source: state.source }]),
    ),
    revision: state.revision,
    readiness: snapshot(),
    models: state.models,
  });

  const snapshot = () => ({
    claude: { ...readiness.claude },
    codex: { ...readiness.codex },
  });

  async function get() {
    return document(await current());
  }

  async function put(name, body) {
    if (typeof name !== 'string' || !FUNCTIONS.includes(name)) throw invalid('function');
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw invalid('body', 'Request body must be a JSON object.');
    for (const key of Object.keys(body))
      if (!['expectedRevision', 'provider', 'model'].includes(key)) throw invalid(key);
    if (typeof body.expectedRevision !== 'string' || !REVISION_PATTERN.test(body.expectedRevision))
      throw invalid('expectedRevision');
    if (typeof body.provider !== 'string' || !PROVIDERS.includes(body.provider))
      throw invalid('provider');
    if (!validModel(body.model))
      throw invalid('model', 'Enter a model id of at most 80 characters.');
    return locked(async () => {
      const state = await current();
      if (state.revision !== body.expectedRevision)
        throw publicError(
          409,
          'SETTINGS_CONFLICT',
          'The provider settings changed since you loaded them. Review the current values.',
          undefined,
          document(state),
        );
      const functions = {
        ...state.functions,
        [name]: { provider: body.provider, model: body.model.trim() },
      };
      // The first save materializes all four functions; later saves rewrite the whole file.
      const text =
        JSON.stringify(
          {
            version: 1,
            ...(state.rawModels === undefined ? {} : { models: state.rawModels }),
            functions: {
              ...Object.fromEntries(FUNCTIONS.map(key => [key, functions[key]])),
              ...(state.rawIntake === undefined ? {} : { intake: state.rawIntake }),
            },
          },
          null,
          2,
        ) + '\n';
      const temporary = `${settingsPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        await fs.mkdir(join(rootDir, 'config'), { recursive: true });
        await fs.writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, settingsPath);
      } catch {
        await fs.unlink(temporary).catch(() => {});
        throw publicError(
          500,
          'SETTINGS_WRITE_FAILED',
          'The provider settings could not be saved.',
        );
      }
      return document({
        functions,
        source: 'file',
        revision: sha256(text),
        models: state.models,
      });
    });
  }

  // Login readiness through the existing login check; no model is ever called.
  async function checkOne(provider) {
    const started = now();
    let result;
    try {
      const config = {
        claude_command: (await launcherConfig('cv-drafting.json')).claude_command || 'claude',
        codex_command: (await launcherConfig('cv-drafting.json')).codex_command || 'codex',
      };
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('timeout'), { timedOut: true })),
          checkTimeoutMs,
        );
      });
      try {
        await Promise.race([
          temporaryWorker(rootDir, cwd => checkLogin(provider, config, cwd)),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
      result = { state: 'ready', message: MESSAGES.ready };
    } catch (error) {
      if (error?.timedOut) result = { state: 'unavailable', message: MESSAGES.timeout };
      else {
        const mapped = classifyLoginFailure(error);
        result = {
          state: mapped.state,
          message: mapped.state === 'unavailable' ? MESSAGES.unavailable(provider) : mapped.message,
        };
      }
    }
    readiness[provider] = { state: result.state, checkedAt: iso(started), message: result.message };
  }

  async function checkReadiness() {
    if (!checking)
      checking = Promise.all(PROVIDERS.map(checkOne)).finally(() => {
        checking = null;
      });
    await checking;
    return { readiness: snapshot() };
  }

  // The effective selection for an action, for the run service to pass as launcher flags.
  async function resolve(action) {
    const { functions } = await current();
    const only = key => ({ provider: functions[key].provider, model: functions[key].model });
    if (action === 'evaluate')
      return { evaluation: only('evaluation'), companyResearch: only('companyResearch') };
    if (action === 'cv') return { cv: only('cv') };
    if (action === 'letter') return { coverLetter: only('coverLetter') };
    return {};
  }

  return Object.freeze({ get, put, checkReadiness, resolve });
}
