import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { access, lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { query as databaseQuery } from '../lib/_database.mjs';
import { resolveCommand } from '../lib/cli-runtime.mjs';
import { slug as companySlug } from '../eval/_evaluation-cli.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { createRunsStore, RunsStoreError } from './runs-store.mjs';
import { PROVIDERS, validModel } from './providers.mjs';
import { createLegacyRuns } from './legacy-runs.mjs';
import { ACTION_REASONS } from './jobs-detail.mjs';

// Run dispatch for the browser dashboard. The argv is fixed per action (no shell, no browser-supplied path),
// the worker is detached and outlives this process, and its output goes to
// logs/dashboard/<log_ref>. State lives in PostgreSQL (browser_runs); nothing here replays or
// kills a process.

export const LAUNCHERS = Object.freeze({
  evaluate: ['src', 'eval', 'evaluate-jobs.mjs'],
  cv: ['src', 'cvgen', 'draft-cv.mjs'],
  letter: ['src', 'cvgen', 'draft-cover-letter.mjs'],
  scan: ['src', 'scan', 'scan.mjs'],
  publish: ['src', 'cvgen', 'publish-cover-letter.mjs'],
  liveness: ['src', 'scan', 'liveness.mjs'],
});
const REQUEST_ACTIONS = new Set([...Object.keys(LAUNCHERS), 'both']);
const ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOG_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_LOG_CHUNK = 64 * 1024;
const DEFAULT_INTERVAL_MS = 30_000;
const STALE_MS = 24 * 60 * 60 * 1000;
const SELECTION_KEYS = ['evaluation', 'companyResearch', 'cv', 'coverLetter'];
// Override keys each job action accepts (STAGE3_DISPATCH_CONTRACT.md).
const OVERRIDE_KEYS = {
  evaluate: ['evaluation', 'companyResearch'],
  cv: ['cv'],
  letter: ['coverLetter'],
  both: ['cv', 'coverLetter'],
};
const QUEUED_STALE_MS = 5 * 60 * 1000;
// At most this many runs of one evaluate batch run at once; the rest wait queued in memory.
const BATCH_CONCURRENCY = 2;
const BATCH_MAX = 100;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

// Public projection of a scan.mjs coverage report: counts, a redacted reason per company and the
// deferred "Missing full JD" postings. Paths, query text and other fields stay out.
export function projectScanReport(report, { rootDir = repositoryRoot } = {}) {
  const count = value => (Number.isInteger(value) && value >= 0 ? value : 0);
  const text = (value, max) => (typeof value === 'string' ? [...value].slice(0, max).join('') : '');
  const summary = report?.summary && typeof report.summary === 'object' ? report.summary : {};
  const httpUrl = value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  };
  const stamp = new Date(report?.generated_at);
  return {
    dryRun: Boolean(report?.dry_run),
    generatedAt: Number.isNaN(stamp.valueOf()) ? new Date(0).toISOString() : stamp.toISOString(),
    summary: {
      structured: count(summary.structured),
      richOnly: count(summary.rich_only),
      unclassified: count(summary.unclassified),
      ok: count(summary.ok),
      empty: count(summary.empty),
      error: count(summary.error),
      jobsFound: count(summary.jobs_found),
      newOffers: count(summary.new_offers),
      missingFullJd: count(summary.missing_full_jd),
    },
    companies: (Array.isArray(report?.companies) ? report.companies : [])
      .slice(0, 1000)
      .map(row => ({
        company: text(row?.company, 200),
        classification: text(row?.classification, 40),
        provider: typeof row?.provider === 'string' && row.provider ? text(row.provider, 80) : null,
        status: text(row?.status, 40),
        jobsFound: count(row?.jobs_found),
        reason:
          typeof row?.reason === 'string' && row.reason
            ? redactLog(text(row.reason, 300), { rootDir })
            : null,
      })),
    missing: (Array.isArray(report?.missing) ? report.missing : [])
      .slice(0, 500)
      .map(row => ({
        company: text(row?.company, 200),
        title: text(row?.title, 300),
        url: httpUrl(row?.url),
      }))
      .filter(row => row.url !== null),
  };
}

// Scans and pasted intakes must not overlap. The in-process lock serializes the critical section
// (intake for its whole duration, scan dispatch for the check-and-launch); a running scan is also
// found through its browser_runs row, since the scanner outlives any request.
export function createDiscoveryLock() {
  let holder = null;
  return {
    tryAcquire(label) {
      if (holder) return null;
      holder = label;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holder = null;
      };
    },
    get holder() {
      return holder;
    },
  };
}

// Launcher flags for the resolved provider selection ({evaluation, companyResearch} / {cv} /
// {coverLetter}). Only well-formed entries become flags; each is one argv element.
function selectionFlags(action, selection) {
  const entry = value =>
    value && PROVIDERS.includes(value.provider) && validModel(value.model) ? value : null;
  const out = [];
  const primary = entry(
    action === 'evaluate'
      ? selection?.evaluation
      : action === 'cv'
        ? selection?.cv
        : selection?.coverLetter,
  );
  if (primary) out.push(`--provider=${primary.provider}`, `--model=${primary.model.trim()}`);
  if (action === 'evaluate') {
    const research = entry(selection?.companyResearch);
    if (research)
      out.push(
        `--research-provider=${research.provider}`,
        `--research-model=${research.model.trim()}`,
      );
  }
  return out;
}

const scanReportName = logRef => `${logRef.replace(/\.log$/, '')}.scan.json`;

export const discoveryBusy = activeRunId =>
  publicError(
    409,
    'DISCOVERY_BUSY',
    'A scan or pasted-JD intake is already running. Wait for it to finish.',
    undefined,
    false,
    { activeRunId },
  );

function publicError(statusCode, publicCode, message, fields, retryable = false, current) {
  const error = new Error(message);
  if (current !== undefined) error.current = current;
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  error.retryable = retryable;
  if (fields) error.fields = fields;
  return error;
}

const invalid = (field, message = 'Request field is invalid.') =>
  publicError(400, 'INVALID_REQUEST', message, { [field]: 'Invalid value.' });
const notFound = () => publicError(404, 'NOT_FOUND', 'Run or job not found.');

// Driver failures never reach the wire: map them to the shared safe errors.
function mapFailure(error) {
  if (error?.publicCode || error instanceof DatabaseUnavailableError) return error;
  if (error instanceof SchemaNotReadyError) return error;
  if (error instanceof RunsStoreError) {
    if (error.code === 'REQUEST_KEY_CONFLICT')
      return publicError(409, 'REQUEST_KEY_CONFLICT', 'That request key was used for another run.');
    if (error.code === 'UNKNOWN_JOB') return notFound();
    if (error.code === 'INVALID_ARGUMENT' || error.code === 'RUN_CONFLICT')
      return publicError(400, 'INVALID_REQUEST', 'Run request is invalid.');
  }
  if (error?.code === '42P01' || error?.code === '42703' || error?.code === '42883')
    return new SchemaNotReadyError();
  return new DatabaseUnavailableError();
}

// The stored selection as sent to the browser: only the known provider entries and scan options.
function publicSelection(selection) {
  const out = {};
  for (const key of SELECTION_KEYS) {
    const entry = selection?.[key];
    if (entry && PROVIDERS.includes(entry.provider) && validModel(entry.model))
      out[key] = { provider: entry.provider, model: entry.model };
  }
  if (typeof selection?.dryRun === 'boolean') out.dryRun = selection.dryRun;
  if (selection && 'company' in selection)
    out.company = typeof selection.company === 'string' ? selection.company : null;
  return out;
}

// Public run shape: no pid and no log reference.
export function toWireRun(run) {
  return {
    id: run.id,
    requestKey: run.requestKey,
    groupId: run.groupId,
    action: run.action,
    jobId: run.jobId,
    state: run.state,
    phase: run.phase,
    attempt: run.attempt,
    exitCode: run.exitCode,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    selection: publicSelection(run.selection),
    source: 'browser',
  };
}

// Redaction for log text returned to the browser. Conservative on purpose: anything that looks
// like a credential, an environment assignment or a private path is replaced.
export function redactLog(text, { rootDir = repositoryRoot } = {}) {
  let out = String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const prefix of [rootDir, homedir()]) {
    if (!prefix || prefix.length < 4) continue;
    const label = prefix === rootDir ? '<repo>' : '<home>';
    const variants = new Set([prefix, prefix.replaceAll('\\', '/'), prefix.replaceAll('/', '\\')]);
    // Also the JSON-escaped form (doubled backslashes) that a launcher prints with JSON.stringify.
    for (const variant of [...variants]) variants.add(variant.replaceAll('\\', '\\\\'));
    for (const variant of variants) out = out.replace(new RegExp(literal(variant), 'gi'), label);
  }
  return (
    out
      .replace(/\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s"']+/g, '<home>')
      .replace(/(\/(?:home|Users))\/[^/\s"']+/g, '<home>')
      .replace(/(authorization\s*[:=]\s*)(bearer|basic|token)?\s*\S+/gi, '$1[redacted]')
      .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
      // JSON-quoted secrets: {"password":"x"}, {"api_key": 123}.
      .replace(
        /("[A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|passphrase|api[_-]?key|apikey|credential|cookie|auth|session)[A-Za-z0-9_.-]*"\s*:\s*)("(?:[^"\\]|\\.)*"|[^\s,}\]]+)/gi,
        '$1"[redacted]"',
      )
      // Command-line flags: --token X, --password=X, --api-key X.
      .replace(
        /(--?[A-Za-z0-9-]*(?:token|secret|password|passwd|pwd|passphrase|api-?key|credential|cookie|auth|session)[A-Za-z0-9-]*)(=|\s+)("[^"\n]*"|'[^'\n]*'|[^\s-]\S*)/gi,
        '$1$2[redacted]',
      )
      .replace(
        /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|passphrase|api[_-]?key|apikey|credential|cookie|auth|session)[A-Za-z0-9_.-]*)\s*([=:])\s*("[^"\n]*"|'[^'\n]*'|\S+)/gi,
        '$1$2[redacted]',
      )
      // A bare "password X" or "passphrase X" in prose.
      .replace(/\b(password|passwd|passphrase)\s+("[^"\n]*"|\S+)/gi, '$1 [redacted]')
      .replace(/^(\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,})=(.*)$/gm, '$1=[redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted]')
      .replace(
        /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|ASIA|AIza)[A-Za-z0-9_-]{12,}/g,
        '[redacted]',
      )
      .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted]')
      .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]')
  );
}

// Start time of a live process, or null when it cannot be read. Only Windows is supported (a
// bounded PowerShell call with an argument array, no shell); elsewhere, and on any failure, the
// caller falls back to the plain "is the pid alive" answer.
export function readProcessStartTime(
  pid,
  { platform = process.platform, run = execFile, timeoutMs = 4000 } = {},
) {
  if (platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
        ],
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout) => {
          if (error) return resolve(null);
          const stamp = new Date(String(stdout).trim());
          resolve(Number.isNaN(stamp.valueOf()) ? null : stamp);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

// A live pid whose process started more than this long from the recorded start belongs to
// another process (the pid was recycled).
export const START_TIME_TOLERANCE_MS = 5000;

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function waitForSpawn(child) {
  if (child.pid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex' };
const PROVIDER_CHECK_TTL_MS = 60_000;
const PROVIDER_CHECK_TIMEOUT_MS = 5_000;

// Cheap existence check for a provider's command line tool: the configured command (the same
// claude_command / codex_command the launchers and the readiness check use) is started with
// --version and bounded to 5 s. Only a failure to start it at all counts as missing; a slow or
// non-zero exit still means the tool exists. No model is called.
export function createProviderCheck({
  rootDir = repositoryRoot,
  spawn = nodeSpawn,
  readConfig = async () =>
    JSON.parse(await readFile(join(rootDir, 'config', 'cv-drafting.json'), 'utf8')),
  timeoutMs = PROVIDER_CHECK_TIMEOUT_MS,
} = {}) {
  return async provider => {
    let config = {};
    try {
      const value = await readConfig();
      if (value && typeof value === 'object' && !Array.isArray(value)) config = value;
    } catch {}
    const configured = config[provider + '_command'];
    const command = typeof configured === 'string' && configured.trim() ? configured : provider;
    const available = await new Promise(resolveCheck => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveCheck(value);
      };
      let child;
      const timer = setTimeout(() => {
        try {
          child?.kill();
        } catch {}
        finish(true);
      }, timeoutMs);
      try {
        const plan = resolveCommand(command, ['--version']);
        child = spawn(plan.command, plan.args, {
          shell: false,
          windowsVerbatimArguments: plan.windowsVerbatimArguments,
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        return finish(false);
      }
      child.on('error', () => finish(false));
      child.on('exit', () => finish(true));
    });
    return { available, command: basename(command) };
  };
}

export function createRunsService({
  store,
  query = databaseQuery,
  spawn = nodeSpawn,
  rootDir = repositoryRoot,
  now = () => new Date(),
  isAlive = defaultIsAlive,
  processStartTime = readProcessStartTime,
  findJob,
  discoveryLock = createDiscoveryLock(),
  resolveSelection = null,
  actionsFor = null,
  checkProvider = createProviderCheck({ rootDir }),
  letterService = null,
  legacy: injectedLegacy,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchConcurrency = BATCH_CONCURRENCY,
  pendingJobIds = null,
  onError = () => {},
} = {}) {
  const runs = store || createRunsStore({ query });
  if (typeof checkProvider !== 'function') throw new TypeError('checkProvider must be a function.');
  // Results are cached for 60 s per provider so repeated dispatches do not spawn a probe each time.
  const providerChecks = new Map();
  async function ensureProviders(selections) {
    const wanted = new Set();
    for (const selection of selections)
      for (const entry of Object.values(selection ?? {}))
        if (entry && typeof entry === 'object' && PROVIDERS.includes(entry.provider))
          wanted.add(entry.provider);
    for (const provider of wanted) {
      let cached = providerChecks.get(provider);
      if (!cached || now().getTime() - cached.at > PROVIDER_CHECK_TTL_MS) {
        let result;
        try {
          result = await checkProvider(provider);
        } catch {
          result = { available: true, command: provider };
        }
        cached = { at: now().getTime(), result };
        providerChecks.set(provider, cached);
      }
      if (!cached.result.available)
        throw publicError(
          409,
          'PROVIDER_UNAVAILABLE',
          `The ${PROVIDER_LABELS[provider]} command line tool was not found on this machine.`,
          undefined,
          false,
          { provider, command: cached.result.command },
        );
    }
  }
  // Legacy TUI task records, listed read-only (null disables; tests of other behaviour pass a temp
  // root with no records).
  const legacy =
    injectedLegacy === undefined
      ? createLegacyRuns({ rootDir, isAlive, processStartTime, now })
      : injectedLegacy;
  if (actionsFor !== null && typeof actionsFor !== 'function')
    throw new TypeError('actionsFor must be a function.');
  for (const adapter of [spawn, now, isAlive, processStartTime, onError])
    if (typeof adapter !== 'function') throw new TypeError('Runs adapters must be functions.');
  const lookupJob =
    findJob ||
    (async id => {
      const rows = await query(
        'SELECT id::text AS id, status, company FROM jobs WHERE id = $1::bigint',
        [id],
      );
      return Array.isArray(rows) && rows[0]
        ? { id: String(rows[0].id), status: rows[0].status, company: rows[0].company }
        : null;
    });
  const logDir = join(rootDir, 'logs', 'dashboard');
  const recordDir = join(logDir, 'tasks');
  let timer = null;

  function validateCreate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw invalid('body', 'Request body must be a JSON object.');
    if (input.action === 'scan') {
      for (const key of Object.keys(input))
        if (!['action', 'requestKey', 'dryRun', 'company'].includes(key)) throw invalid(key);
      if (typeof input.requestKey !== 'string' || !KEY_PATTERN.test(input.requestKey))
        throw invalid('requestKey');
      if (typeof input.dryRun !== 'boolean') throw invalid('dryRun');
      let company = null;
      if (input.company !== undefined && input.company !== null) {
        if (typeof input.company !== 'string') throw invalid('company');
        // eslint-disable-next-line no-control-regex
        company = input.company.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
        if (!company || [...company].length > 100 || input.company !== input.company.trim())
          throw invalid('company');
      }
      return {
        action: 'scan',
        jobId: null,
        requestKey: input.requestKey,
        dryRun: input.dryRun,
        company,
      };
    }
    if (input.action === 'liveness') {
      for (const key of Object.keys(input))
        if (!['action', 'requestKey', 'jobId'].includes(key)) throw invalid(key);
      if (typeof input.requestKey !== 'string' || !KEY_PATTERN.test(input.requestKey))
        throw invalid('requestKey');
      let jobId = null;
      if (input.jobId !== undefined && input.jobId !== null) {
        if (typeof input.jobId !== 'string' || !ID_PATTERN.test(input.jobId))
          throw invalid('jobId');
        jobId = input.jobId;
      }
      return { action: 'liveness', jobId, requestKey: input.requestKey };
    }
    if (input.action === 'publish') {
      for (const key of Object.keys(input))
        if (!['action', 'jobId', 'requestKey', 'expectedHash'].includes(key)) throw invalid(key);
      if (typeof input.jobId !== 'string' || !ID_PATTERN.test(input.jobId)) throw invalid('jobId');
      if (typeof input.requestKey !== 'string' || !KEY_PATTERN.test(input.requestKey))
        throw invalid('requestKey');
      if (typeof input.expectedHash !== 'string' || !HASH_PATTERN.test(input.expectedHash))
        throw invalid('expectedHash');
      return {
        action: 'publish',
        jobId: input.jobId,
        requestKey: input.requestKey,
        expectedHash: input.expectedHash,
      };
    }
    for (const key of Object.keys(input))
      if (!['action', 'jobId', 'requestKey', 'selection'].includes(key)) throw invalid(key);
    if (typeof input.action !== 'string' || !REQUEST_ACTIONS.has(input.action))
      throw invalid('action', 'This action is not available from the browser yet.');
    if (typeof input.jobId !== 'string' || !ID_PATTERN.test(input.jobId)) throw invalid('jobId');
    if (typeof input.requestKey !== 'string' || !KEY_PATTERN.test(input.requestKey))
      throw invalid('requestKey');
    return {
      action: input.action,
      jobId: input.jobId,
      requestKey: input.requestKey,
      override: validateOverride(input.action, input.selection),
    };
  }

  // One-run override, validated like a settings save: only the keys this action accepts, each
  // a {provider, model} pair with a known provider and a model of at most 80 characters.
  function validateOverride(action, value) {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw invalid('selection', 'The provider selection must be an object.');
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!OVERRIDE_KEYS[action].includes(key)) throw invalid('selection');
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid('selection');
      for (const field of Object.keys(entry))
        if (!['provider', 'model'].includes(field)) throw invalid('selection');
      if (!PROVIDERS.includes(entry.provider) || !validModel(entry.model))
        throw invalid('selection');
      out[key] = { provider: entry.provider, model: entry.model.trim() };
    }
    return out;
  }

  // Job dispatches are checked and recorded one at a time so two requests cannot both pass the
  // active-run rule.
  let dispatchChain = Promise.resolve();
  const serialized = callback => {
    const run = dispatchChain.then(callback, callback);
    dispatchChain = run.catch(() => {});
    return run;
  };

  // Re-checks the prerequisites the detail route shows. A failed prerequisite is
  // PREREQUISITE_FAILED with the fresh action block; an active run of the same action is
  // RUN_ACTIVE with its id. Only the tasks that would start are checked (a replayed key never is).
  async function checkPrerequisites(jobId, action, pending) {
    if (!actionsFor) return;
    const facts = await actionsFor(jobId);
    if (!facts) throw notFound();
    const names = action === 'both' && pending.length === 2 ? ['both'] : pending;
    for (const name of names) {
      const reason = facts.base?.[name]?.reason ?? null;
      if (reason)
        throw publicError(409, 'PREREQUISITE_FAILED', reason, undefined, false, {
          actions: facts.actions,
        });
    }
    const active = (await runs.list({ jobId })).filter(run =>
      ['queued', 'running'].includes(run.state),
    );
    for (const task of pending) {
      // A publish renders the saved letter, so a running letter draft blocks it as well.
      const blocking = task === 'publish' ? ['publish', 'letter'] : [task];
      const running = active.find(run => blocking.includes(run.action));
      if (running)
        throw publicError(
          409,
          'RUN_ACTIVE',
          `A ${running.action} run is already active.`,
          undefined,
          false,
          { activeRunId: running.id },
        );
    }
  }

  async function guarded(callback) {
    try {
      return await callback();
    } catch (error) {
      throw mapFailure(error);
    }
  }

  async function writeLegacyRecord(run, pid, logPath, recordPath) {
    // The TUI task monitor reads this record; the worker is its writer after launch. Merge so a
    // worker that already reported is not overwritten.
    let existing = {};
    try {
      existing = JSON.parse(await readFile(recordPath, 'utf8'));
    } catch {
      // No record yet.
    }
    const record = {
      run_id: run.id,
      action: run.action,
      number: Number(run.jobId ?? 0),
      pid,
      log: logPath,
      state: 'running',
      phase: 'starting',
      attempt: 1,
      started_at: now().toISOString(),
      ...existing,
    };
    record.pid = pid;
    const temporary = `${recordPath}.${process.pid}.tmp`;
    await mkdir(recordDir, { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, recordPath);
  }

  async function failSpawn(run) {
    return runs.finish(run.id, 'failed', null, 'SPAWN_FAILED');
  }

  // `onDone` fires once when the worker has exited or never started (frees a batch slot).
  async function launch(run, { publishPath, onDone } = {}) {
    const done = () => {
      try {
        onDone?.();
      } catch (error) {
        onError(error);
      }
    };
    const script = join(rootDir, ...LAUNCHERS[run.action]);
    const logPath = join(logDir, run.logRef);
    const recordPath = join(recordDir, `${run.logRef.replace(/\.log$/, '')}.json`);
    let fd;
    let child;
    try {
      await access(script);
      await mkdir(logDir, { recursive: true, mode: 0o700 });
      fd = openSync(logPath, 'a', 0o600);
      const args =
        run.action === 'publish'
          ? [script, publishPath]
          : run.action === 'liveness'
            ? [script, run.jobId ? `--job=${run.jobId}` : '--all']
            : run.action === 'scan'
              ? [
                  script,
                  ...(run.selection?.dryRun ? ['--dry-run'] : []),
                  ...(run.selection?.company ? [`--company=${run.selection.company}`] : []),
                  `--report-json=${join('logs', 'dashboard', scanReportName(run.logRef))}`,
                ]
              : [script, `--job=${run.jobId}`, ...selectionFlags(run.action, run.selection)];
      child = spawn(process.execPath, args, {
        cwd: rootDir,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
        env: { ...process.env, CAREER_TASK_FILE: recordPath, CAREER_RUN_ID: run.id },
      });
      await waitForSpawn(child);
    } catch {
      if (fd !== undefined) closeSync(fd);
      try {
        return await failSpawn(run);
      } finally {
        done();
      }
    }
    // From here a worker exists, so nothing below may throw before its pid is recorded and its
    // exit is observed. While this server lives it observes the exit, so a worker whose own
    // report could not land still ends truthfully; the terminal call is once-only and a worker's
    // report wins if it arrived first.
    child.once('exit', code => {
      const ok = code === 0;
      runs
        .finish(run.id, ok ? 'completed' : 'failed', code ?? null, ok ? null : 'EXIT_NONZERO')
        .catch(onError)
        .finally(done);
    });
    child.unref();
    let running = run;
    try {
      running = await runs.start(run.id, child.pid, now());
    } catch (error) {
      // The row stays queued and live; reconcile settles a stale queued row as interrupted.
      onError(error);
    }
    try {
      closeSync(fd);
    } catch (error) {
      onError(error);
    }
    try {
      await writeLegacyRecord(run, child.pid, logPath, recordPath);
    } catch (error) {
      onError(error);
    }
    return running;
  }

  async function dispatchScan({ requestKey, dryRun, company }) {
    return guarded(async () => {
      const selection = { dryRun, company };
      const sameScan = existing =>
        existing.action === 'scan' &&
        existing.jobId === null &&
        Boolean(existing.selection?.dryRun) === dryRun &&
        (existing.selection?.company ?? null) === company;
      let existing = await runs.getByRequestKey(requestKey);
      if (existing) {
        if (!sameScan(existing))
          throw mapFailure(new RunsStoreError('REQUEST_KEY_CONFLICT', 'conflict'));
        return { runs: [toWireRun(existing)], replayed: true };
      }
      const release = discoveryLock.tryAcquire('scan');
      if (!release) throw discoveryBusy(null);
      try {
        const active = await activeScanRun();
        if (active) throw discoveryBusy(active.id);
        // A whole-board posting check is discovery work too: a scan waits for it.
        const checking = (await runs.list({ limit: 0 })).find(
          run =>
            run.action === 'liveness' &&
            run.jobId === null &&
            ['queued', 'running'].includes(run.state),
        );
        if (checking) throw discoveryBusy(checking.id);
        const stamp = now()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\..*$/, '')
          .replace('T', '-');
        const logRef = `scan-${stamp}-${randomBytes(4).toString('hex')}.log`;
        let run;
        try {
          run = await runs.insert({ requestKey, action: 'scan', jobId: null, logRef, selection });
        } catch (error) {
          if (error instanceof RunsStoreError && error.code === 'REQUEST_KEY_CONFLICT') {
            existing = await runs.getByRequestKey(requestKey);
            if (existing && sameScan(existing))
              return { runs: [toWireRun(existing)], replayed: true };
          }
          throw error;
        }
        return { runs: [toWireRun(await launch(run))], replayed: false };
      } finally {
        release();
      }
    });
  }

  // Posting check (D117): one job or the whole board. The whole-board run never overlaps another
  // liveness run or a scan; a single-job run never overlaps another run of that job.
  async function dispatchLiveness({ requestKey, jobId }) {
    return serialized(() =>
      guarded(async () => {
        if (jobId && !(await lookupJob(jobId))) throw notFound();
        const same = existing => existing.action === 'liveness' && existing.jobId === jobId;
        let existing = await runs.getByRequestKey(requestKey);
        if (existing) {
          if (!same(existing))
            throw mapFailure(new RunsStoreError('REQUEST_KEY_CONFLICT', 'conflict'));
          return { runs: [toWireRun(existing)], replayed: true };
        }
        const release = jobId ? () => {} : discoveryLock.tryAcquire('liveness');
        if (!release) throw discoveryBusy(null);
        try {
          const active = (await runs.list(jobId ? { jobId } : { limit: 0 })).filter(run =>
            ['queued', 'running'].includes(run.state),
          );
          const busy = jobId
            ? active[0]
            : active.find(run => run.action === 'liveness' && run.jobId === null);
          if (busy)
            throw publicError(
              409,
              'RUN_ACTIVE',
              `A ${busy.action} run is already active.`,
              undefined,
              false,
              { activeRunId: busy.id },
            );
          if (!jobId) {
            const scan = await activeScanRun();
            if (scan) throw discoveryBusy(scan.id);
          }
          const stamp = now()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..*$/, '')
            .replace('T', '-');
          const logRef = `liveness-${jobId ?? 'all'}-${stamp}-${randomBytes(4).toString('hex')}.log`;
          let run;
          try {
            run = await runs.insert({
              requestKey,
              groupId: null,
              action: 'liveness',
              jobId,
              logRef,
              selection: {},
            });
          } catch (error) {
            if (error instanceof RunsStoreError && error.code === 'REQUEST_KEY_CONFLICT') {
              existing = await runs.getByRequestKey(requestKey);
              if (existing && same(existing))
                return { runs: [toWireRun(existing)], replayed: true };
            }
            throw error;
          }
          return { runs: [toWireRun(await launch(run))], replayed: false };
        } finally {
          release();
        }
      }),
    );
  }

  async function activeScanRun() {
    const active = await runs.list({ limit: 0 });
    return (
      active.find(run => run.action === 'scan' && ['queued', 'running'].includes(run.state)) ?? null
    );
  }

  // The id of a scan that is queued or running, or null. Used by intake to refuse to overlap.
  async function activeScan() {
    return guarded(async () => (await activeScanRun())?.id ?? null);
  }

  // Publication of the saved cover letter: the hash the user saved must still be the file's hash,
  // the argv is the launcher plus the absolute path of the matched cover-letter.md, and there is
  // no provider selection. The letter service's mutex spans the check and the run row, so a save
  // cannot land in between.
  async function dispatchPublish({ jobId, requestKey, expectedHash }) {
    if (!letterService)
      throw publicError(503, 'TASKS_UNAVAILABLE', 'Task dispatch is not available in this server.');
    return serialized(() =>
      letterService.exclusive(() =>
        guarded(async () => {
          if (!(await lookupJob(jobId))) throw notFound();
          const same = existing => existing.action === 'publish' && existing.jobId === jobId;
          let existing = await runs.getByRequestKey(requestKey);
          if (existing) {
            if (!same(existing))
              throw mapFailure(new RunsStoreError('REQUEST_KEY_CONFLICT', 'conflict'));
            return { runs: [toWireRun(existing)], replayed: true };
          }
          await checkPrerequisites(jobId, 'publish', ['publish']);
          const letter = await letterService.snapshot(jobId);
          if (!letter?.editable) {
            const facts = actionsFor ? await actionsFor(jobId) : null;
            throw publicError(
              409,
              'PREREQUISITE_FAILED',
              ACTION_REASONS.noLetter,
              undefined,
              false,
              facts ? { actions: facts.actions } : undefined,
            );
          }
          if (letter.contentHash !== expectedHash)
            throw publicError(
              409,
              'LETTER_CONFLICT',
              'The letter changed since it was loaded.',
              undefined,
              false,
              { text: letter.text, contentHash: letter.contentHash },
            );
          const stamp = now()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..*$/, '')
            .replace('T', '-');
          const logRef = `publish-${jobId}-${stamp}-${randomBytes(4).toString('hex')}.log`;
          let run;
          try {
            run = await runs.insert({
              requestKey,
              groupId: null,
              action: 'publish',
              jobId,
              logRef,
              selection: {},
            });
          } catch (error) {
            if (error instanceof RunsStoreError && error.code === 'REQUEST_KEY_CONFLICT') {
              existing = await runs.getByRequestKey(requestKey);
              if (existing && same(existing))
                return { runs: [toWireRun(existing)], replayed: true };
            }
            throw error;
          }
          return {
            runs: [toWireRun(await launch(run, { publishPath: letter.path }))],
            replayed: false,
          };
        }),
      ),
    );
  }

  async function dispatch(input) {
    const validated = validateCreate(input);
    if (validated.action === 'scan') return dispatchScan(validated);
    if (validated.action === 'liveness') return dispatchLiveness(validated);
    if (validated.action === 'publish') return dispatchPublish(validated);
    const { action, jobId, requestKey, override } = validated;
    return serialized(() =>
      guarded(async () => {
        const job = await lookupJob(jobId);
        if (!job) throw notFound();
        const tasks = action === 'both' ? ['cv', 'letter'] : [action];
        const groupId = tasks.length > 1 ? randomUUID() : null;
        const keyOf = task => (tasks.length > 1 ? `${requestKey}:${task}` : requestKey);
        const sameRun = (existing, task) => existing.action === task && existing.jobId === jobId;
        const found = new Map();
        for (const task of tasks) {
          const existing = await runs.getByRequestKey(keyOf(task));
          if (existing) {
            if (!sameRun(existing, task))
              throw mapFailure(new RunsStoreError('REQUEST_KEY_CONFLICT', 'conflict'));
            found.set(task, existing);
          }
        }
        await checkPrerequisites(
          jobId,
          action,
          tasks.filter(task => !found.has(task)),
        );
        // Resolve every pending child's selection before launching any, so a settings read failure
        // cannot leave one child live and the other never recorded.
        const selections = new Map();
        for (const task of tasks) {
          if (found.has(task)) continue;
          // Saved (or legacy) selection with the one-run override merged over it; never persisted
          // to the settings file.
          const selection = { ...(resolveSelection ? await resolveSelection(task) : {}) };
          for (const key of OVERRIDE_KEYS[task]) if (override[key]) selection[key] = override[key];
          selections.set(task, selection);
        }
        await ensureProviders(selections.values());
        const results = [];
        let replayed = true;
        for (const task of tasks) {
          const key = keyOf(task);
          const same = existing => sameRun(existing, task);
          let run = found.get(task);
          if (run) {
            results.push(run);
            continue;
          }
          const stamp = now()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..*$/, '')
            .replace('T', '-');
          const logRef = `${task}-${jobId}-${stamp}-${randomBytes(4).toString('hex')}.log`;
          try {
            run = await runs.insert({
              requestKey: key,
              groupId,
              action: task,
              jobId,
              logRef,
              selection: selections.get(task),
            });
          } catch (error) {
            if (error instanceof RunsStoreError && error.code === 'REQUEST_KEY_CONFLICT') {
              const winner = await runs.getByRequestKey(key);
              if (winner && same(winner)) {
                results.push(winner);
                continue;
              }
            }
            throw error;
          }
          replayed = false;
          // A single evaluate is never held back, but its company holds waiting batch runs.
          results.push(await launch(run, task === 'evaluate' ? holdCompany(job) : {}));
        }
        return { runs: results.map(toWireRun), replayed };
      }),
    );
  }

  // ---- Evaluate batches -------------------------------------------------------------------
  // A batch inserts one queued evaluate run per eligible job under one group, then starts at most
  // `batchConcurrency` of them; the rest wait in this in-memory table and start as earlier ones
  // exit. Rows waiting here are exempt from the stale-queued reconcile; after a server restart the
  // table is empty, so those rows are settled as QUEUE_STALE like any orphaned queued row.
  const batchGroups = new Map(); // groupId -> { waiting: run[], active: number }
  const waitingIds = new Set();
  const launchingIds = new Set();

  // Company slug per waiting or live batch run. evaluate-jobs.mjs researches a company into one
  // cache file and fails if it changes mid-run, so two runs for one company never overlap: a
  // waiting run starts only when no live batch run (in any group) has its company. An unknown
  // company (empty slug) never blocks.
  const runCompanies = new Map();
  const liveCompanies = new Map(); // slug -> number of launched, not yet exited runs

  // Counts a launched single evaluate against its company until it exits (`launch` option).
  function holdCompany(job) {
    const company = typeof job?.company === 'string' ? companySlug(job.company) : '';
    if (!company) return {};
    liveCompanies.set(company, (liveCompanies.get(company) ?? 0) + 1);
    return {
      onDone: () => {
        const left = (liveCompanies.get(company) ?? 1) - 1;
        if (left > 0) liveCompanies.set(company, left);
        else liveCompanies.delete(company);
        for (const id of [...batchGroups.keys()]) pumpGroup(id);
      },
    };
  }

  function pumpGroup(groupId) {
    const group = batchGroups.get(groupId);
    if (!group) return [];
    const started = [];
    while (group.active < batchConcurrency) {
      const index = group.waiting.findIndex(run => {
        const company = runCompanies.get(run.id) ?? '';
        return !company || !liveCompanies.get(company);
      });
      if (index < 0) break;
      const [run] = group.waiting.splice(index, 1);
      const company = runCompanies.get(run.id) ?? '';
      waitingIds.delete(run.id);
      launchingIds.add(run.id);
      group.active += 1;
      if (company) liveCompanies.set(company, (liveCompanies.get(company) ?? 0) + 1);
      started.push(
        launch(run, {
          onDone: () => {
            launchingIds.delete(run.id);
            runCompanies.delete(run.id);
            group.active -= 1;
            if (company) {
              const left = (liveCompanies.get(company) ?? 1) - 1;
              if (left > 0) liveCompanies.set(company, left);
              else liveCompanies.delete(company);
            }
            if (!group.waiting.length && group.active === 0) batchGroups.delete(groupId);
            // A freed company can unblock a run in any group.
            for (const id of [...batchGroups.keys()]) pumpGroup(id);
          },
        }).catch(error => {
          onError(error);
          return run;
        }),
      );
    }
    return started;
  }

  function validateBatch(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw invalid('body', 'Request body must be a JSON object.');
    for (const key of Object.keys(input))
      if (!['requestKey', 'jobIds', 'next'].includes(key)) throw invalid(key);
    if (typeof input.requestKey !== 'string' || !KEY_PATTERN.test(input.requestKey))
      throw invalid('requestKey');
    if ((input.jobIds === undefined) === (input.next === undefined))
      throw invalid('jobIds', 'Send exactly one of jobIds or next.');
    if (input.jobIds !== undefined) {
      const ids = input.jobIds;
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > BATCH_MAX ||
        ids.some(id => typeof id !== 'string' || !ID_PATTERN.test(id)) ||
        new Set(ids).size !== ids.length
      )
        throw invalid('jobIds');
      return { requestKey: input.requestKey, jobIds: [...ids] };
    }
    if (!Number.isInteger(input.next) || input.next < 1 || input.next > BATCH_MAX)
      throw invalid('next');
    return { requestKey: input.requestKey, next: input.next };
  }

  // Same order as `node src/eval/next-jobs.mjs --json N` (Pending, ascending id, first N).
  async function nextPending(count) {
    if (pendingJobIds) return pendingJobIds(count);
    const rows = await query(
      "SELECT id::text AS id FROM jobs WHERE status='Pending' ORDER BY id LIMIT $1",
      [count],
    );
    return (Array.isArray(rows) ? rows : (rows?.rows ?? [])).map(row => String(row.id));
  }

  async function dispatchEvaluateBatch(input) {
    const validated = validateBatch(input);
    const { requestKey } = validated;
    return serialized(() =>
      guarded(async () => {
        // The first run carries the batch key itself, so a replay finds the group through it.
        const first = await runs.getByRequestKey(requestKey);
        if (first) {
          if (first.action !== 'evaluate' || !first.groupId)
            throw mapFailure(new RunsStoreError('REQUEST_KEY_CONFLICT', 'conflict'));
          const members = await runs.listByGroup(first.groupId);
          return {
            groupId: first.groupId,
            runs: members.map(toWireRun),
            skipped: [],
            replayed: true,
          };
        }
        const candidates = validated.jobIds ?? (await nextPending(validated.next));
        const skipped = [];
        const eligible = [];
        const companyOf = new Map();
        for (const jobId of candidates) {
          try {
            const job = await lookupJob(jobId);
            if (!job) {
              skipped.push({ jobId, reason: 'Job not found.' });
              continue;
            }
            await checkPrerequisites(jobId, 'evaluate', ['evaluate']);
            eligible.push(jobId);
            companyOf.set(jobId, typeof job.company === 'string' ? companySlug(job.company) : '');
          } catch (error) {
            const mapped = mapFailure(error);
            if (mapped instanceof DatabaseUnavailableError || mapped instanceof SchemaNotReadyError)
              throw mapped;
            skipped.push({ jobId, reason: mapped.message });
          }
        }
        if (!eligible.length)
          throw publicError(
            409,
            'NO_ELIGIBLE_JOBS',
            'No job in this request can be evaluated.',
            undefined,
            false,
            { skipped },
          );
        const selection = { ...(resolveSelection ? await resolveSelection('evaluate') : {}) };
        await ensureProviders([selection]);
        const groupId = randomUUID();
        const inserted = [];
        for (const [index, jobId] of eligible.entries()) {
          const stamp = now()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..*$/, '')
            .replace('T', '-');
          inserted.push(
            await runs.insert({
              requestKey: index === 0 ? requestKey : `${requestKey}:${jobId}`,
              groupId,
              action: 'evaluate',
              jobId,
              logRef: `evaluate-${jobId}-${stamp}-${randomBytes(4).toString('hex')}.log`,
              selection,
            }),
          );
        }
        batchGroups.set(groupId, { waiting: [...inserted], active: 0 });
        for (const run of inserted) {
          waitingIds.add(run.id);
          runCompanies.set(run.id, companyOf.get(run.jobId) ?? '');
        }
        const started = new Map();
        for (const run of await Promise.all(pumpGroup(groupId))) started.set(run.id, run);
        return {
          groupId,
          runs: inserted.map(run => toWireRun(started.get(run.id) ?? run)),
          skipped,
          replayed: false,
        };
      }),
    );
  }

  // Interrupts the group's runs that never started. Running runs are left alone. Rows waiting in
  // this process are removed from the queue; queued rows nothing here will start (orphans of an
  // earlier server) are settled too. A run already being launched is not touched.
  async function cancelQueued(groupId) {
    if (typeof groupId !== 'string' || !UUID_PATTERN.test(groupId)) throw invalid('groupId');
    return guarded(async () => {
      const members = await runs.listByGroup(groupId);
      if (!members.length) throw notFound();
      const group = batchGroups.get(groupId);
      if (group) {
        for (const run of group.waiting) {
          waitingIds.delete(run.id);
          runCompanies.delete(run.id);
        }
        group.waiting = [];
        if (group.active === 0) batchGroups.delete(groupId);
      }
      let cancelled = 0;
      for (const run of members) {
        if (run.state !== 'queued' || launchingIds.has(run.id)) continue;
        const settled = await runs.finish(run.id, 'interrupted', null, 'CANCELLED');
        if (settled.state === 'interrupted' && settled.errorCode === 'CANCELLED') cancelled += 1;
      }
      return { groupId, cancelled };
    });
  }

  // `limit` is the number of terminal rows (default 12, 1 to 50); active rows are always listed.
  async function list({ jobId, limit } = {}) {
    if (jobId !== undefined && (typeof jobId !== 'string' || !ID_PATTERN.test(jobId)))
      throw invalid('jobId');
    let bound;
    if (limit !== undefined) {
      const number =
        typeof limit === 'string' && /^[0-9]{1,3}$/.test(limit) ? Number(limit) : limit;
      if (!Number.isInteger(number) || number < 1 || number > 50) throw invalid('limit');
      bound = number;
    }
    return guarded(async () => {
      const browser = (
        await runs.list({ jobId, ...(bound === undefined ? {} : { limit: bound }) })
      ).map(toWireRun);
      if (!legacy) return { runs: browser };
      // Legacy rows follow the browser rows; the terminal limit covers both sources together.
      const terminal = browser.filter(run => !['queued', 'running'].includes(run.state)).length;
      const room = Math.max(0, (bound ?? 12) - terminal);
      let older = [];
      try {
        older = await legacy.list({ jobId, limit: room });
      } catch (error) {
        // A broken legacy folder never hides browser runs.
        onError(error);
      }
      return { runs: [...browser, ...older] };
    });
  }

  async function loadRun(id) {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) throw invalid('id');
    const run = await runs.get(id);
    if (!run) throw notFound();
    return run;
  }

  // A legacy run id resolves only when no browser run has it.
  async function legacyRow(id) {
    if (!legacy || typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;
    try {
      return await legacy.find(id);
    } catch (error) {
      onError(error);
      return null;
    }
  }

  async function get(id) {
    return guarded(async () => {
      if (typeof id === 'string' && UUID_PATTERN.test(id) && !(await runs.get(id))) {
        const row = await legacyRow(id);
        if (row) return { run: row.run };
      }
      return { run: toWireRun(await loadRun(id)) };
    });
  }

  // Parsed scan report for a scan run, or 404 while the file does not exist yet.
  async function scanReport(id) {
    const run = await guarded(() => loadRun(id));
    if (run.action !== 'scan' || !LOG_REF_PATTERN.test(run.logRef)) throw notFound();
    const unavailable = () => publicError(404, 'NOT_FOUND', 'Scan report is not available yet.');
    const path = join(logDir, scanReportName(run.logRef));
    let text;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_REPORT_BYTES)
        throw unavailable();
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (error?.publicCode) throw error;
      throw unavailable();
    }
    let report;
    try {
      report = JSON.parse(text);
    } catch {
      throw unavailable();
    }
    return projectScanReport(report, { rootDir });
  }

  // Bounded sanitized view of a run's log. `offset` is a byte position from a previous
  // `nextOffset`; without it the tail of the file is returned. Chunks end on a line boundary so a
  // secret is never split across two responses.
  async function log(id, { offset } = {}) {
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0))
      throw invalid('offset');
    let run = await guarded(async () =>
      typeof id === 'string' && UUID_PATTERN.test(id) && !(await runs.get(id)) ? null : loadRun(id),
    );
    if (!run) {
      // A legacy run: its log is the file named by the record, read only from logs/dashboard.
      const row = await legacyRow(id);
      if (!row?.logRef) throw notFound();
      run = { logRef: row.logRef };
    }
    if (!LOG_REF_PATTERN.test(run.logRef)) throw notFound();
    const path = join(logDir, run.logRef);
    let handle;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw notFound();
      handle = await open(path, 'r');
      const size = info.size;
      let start = offset ?? Math.max(0, size - MAX_LOG_CHUNK);
      if (start > size) start = size;
      const buffer = Buffer.alloc(Math.min(MAX_LOG_CHUNK, size - start));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let chunk = buffer.subarray(0, bytesRead);
      if (offset === undefined && start > 0) {
        const newline = chunk.indexOf(0x0a);
        if (newline >= 0) {
          chunk = chunk.subarray(newline + 1);
          start += newline + 1;
        }
      }
      let end = start + chunk.length;
      if (end < size) {
        const last = chunk.lastIndexOf(0x0a);
        if (last >= 0) {
          chunk = chunk.subarray(0, last + 1);
          end = start + chunk.length;
        }
      }
      return {
        text: redactLog(chunk.toString('utf8'), { rootDir }),
        offset: start,
        nextOffset: end,
        size,
        truncated: start > 0,
      };
    } catch (error) {
      if (error?.publicCode) throw error;
      if (error?.code === 'ENOENT')
        return { text: '', offset: 0, nextOffset: 0, size: 0, truncated: false };
      throw publicError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  // True when the recorded pid is alive and, where the platform can say, still the process that
  // was started: a live pid with a different start time was recycled and counts as gone. When the
  // start time cannot be read this is the plain signal-0 answer.
  async function isSameProcess(run) {
    if (!isAlive(run.pid)) return false;
    if (!run.pidStartedAt) return true;
    let actual = null;
    try {
      actual = await processStartTime(run.pid);
    } catch {
      actual = null;
    }
    if (!actual) return true;
    return (
      Math.abs(new Date(actual).getTime() - new Date(run.pidStartedAt).getTime()) <=
      START_TIME_TOLERANCE_MS
    );
  }

  // Marks running rows whose process is gone, or that started over 24 h ago, as interrupted.
  // A worker that finished while this server was down left its own record behind; that
  // synchronous record is the truth for a dead pid, so it is honoured before "interrupted".
  async function reconcile() {
    try {
      const active = await runs.list({ limit: 0 });
      const settled = [];
      // A queued row that never started (a crash between insert and start, or a failed start
      // call) will not progress by itself: after a few minutes it is interrupted.
      for (const run of active.filter(row => row.state === 'queued')) {
        if (waitingIds.has(run.id)) continue; // waiting its turn in a live batch
        if (now().getTime() - new Date(run.createdAt).getTime() > QUEUED_STALE_MS)
          settled.push(await runs.finish(run.id, 'interrupted', null, 'QUEUE_STALE'));
      }
      const running = active.filter(run => run.state === 'running');
      const deadPids = [];
      for (const run of running) {
        if (run.pid && (await isSameProcess(run))) continue;
        let record = null;
        try {
          record = JSON.parse(
            await readFile(join(recordDir, `${run.logRef.replace(/\.log$/, '')}.json`), 'utf8'),
          );
        } catch {
          // No usable record.
        }
        if (record?.state === 'completed' || record?.state === 'failed') {
          const ok = record.state === 'completed';
          await runs.finish(
            run.id,
            record.state,
            Number.isInteger(record.exit_code) ? record.exit_code : null,
            ok ? null : 'EXIT_NONZERO',
          );
        } else deadPids.push(run.pid);
      }
      const changed = await runs.interruptStale({ deadPids, now: now() });
      return [...settled, ...changed].map(toWireRun);
    } catch (error) {
      onError(error);
      return [];
    }
  }

  // True only when the migration is applied; the spawn path is wired by construction.
  async function ready() {
    try {
      const rows = await query(
        "SELECT to_regclass('browser_runs') IS NOT NULL AND " +
          "to_regproc('start_browser_run') IS NOT NULL AS ready",
      );
      return Array.isArray(rows) && rows[0]?.ready === true;
    } catch {
      return false;
    }
  }

  function start() {
    if (timer) return;
    reconcile();
    timer = setInterval(reconcile, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return Object.freeze({
    dispatch,
    dispatchEvaluateBatch,
    cancelQueued,
    list,
    get,
    log,
    scanReport,
    activeScan,
    reconcile,
    ready,
    start,
    stop,
    STALE_MS,
  });
}
