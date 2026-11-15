import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { findJobByUrl, legacyUrlKey, query as databaseQuery, urlKey } from '../lib/_database.mjs';
import { root as repositoryRoot } from '../lib/root.mjs';
import { normalizeUrl } from '../scan/add-pasted-jd.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { createDiscoveryLock, discoveryBusy } from './runs.mjs';

// Pasted-JD intake (STAGE3_INTAKE_SCAN_CONTRACT.md). The launcher src/scan/add-pasted-jd.mjs is
// the only rule source: it is run by argv with the JSON payload on stdin, bounded in time and
// output, and its fixed messages are mapped to public errors. The text is passed through
// byte for byte, and nothing here re-implements the launcher's validation.

const MAX_FIELD = 300;
const MAX_URL = 2048;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_SUGGESTIONS = 10;
const SCRIPT = ['src', 'scan', 'add-pasted-jd.mjs'];

function publicError(statusCode, publicCode, message, fields, current, retryable = false) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  error.retryable = retryable;
  if (fields) error.fields = fields;
  if (current !== undefined) error.current = current;
  return error;
}

const invalid = (field, message = 'Request field is invalid.') =>
  publicError(400, 'INVALID_REQUEST', message, { [field]: 'Invalid value.' });

function mapDatabaseFailure(error) {
  if (error?.publicCode || error instanceof DatabaseUnavailableError) return error;
  if (error instanceof SchemaNotReadyError) return error;
  if (error?.code === '42P01' || error?.code === '42703') return new SchemaNotReadyError();
  return new DatabaseUnavailableError();
}

const compact = value =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function onlyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw invalid('body', 'Request body must be a JSON object.');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw invalid(key);
}

// Default executor: argv only (no shell), stdin payload, bounded output and a hard timeout.
export function runLauncher({ command, args, cwd, input, env, timeoutMs = TIMEOUT_MS }) {
  return new Promise(resolveRun => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolveRun({ code: null, stdout: '', stderr: '', timedOut: false, failed: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const take = (current, chunk) =>
      current.length >= MAX_OUTPUT
        ? current
        : (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT);
    child.stdout.on('data', chunk => (stdout = take(stdout, chunk)));
    child.stderr.on('data', chunk => (stderr = take(stderr, chunk)));
    child.once('error', () => finish({ code: null, stdout, stderr, timedOut, failed: true }));
    child.once('close', code => finish({ code, stdout, stderr, timedOut, failed: false }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function createIntakeService({
  query = databaseQuery,
  execute = runLauncher,
  rootDir = repositoryRoot,
  env = process.env,
  discoveryLock = createDiscoveryLock(),
  activeScanRunId = async () => null,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  for (const adapter of [query, execute, activeScanRunId])
    if (typeof adapter !== 'function') throw new TypeError('Intake adapters must be functions.');

  const guarded = async callback => {
    try {
      return await callback();
    } catch (error) {
      throw mapDatabaseFailure(error);
    }
  };

  async function lookup(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return { url: null, tracked: null, seen: null };
    const key = urlKey(normalized);
    const tracked = await findJobByUrl(normalized, { query });
    const jobs = tracked ? [tracked] : [];
    if (jobs[0])
      return {
        url: normalized,
        tracked: {
          id: String(jobs[0].id),
          company: String(jobs[0].company),
          role: String(jobs[0].role),
          status: String(jobs[0].status),
        },
        seen: null,
      };
    // Same match as the TUI: scan_history URLs reduced with the urlKey rules.
    const seen = await query(
      `SELECT company, title, status, first_seen::text AS first_seen
         FROM scan_history
        WHERE lower(regexp_replace(regexp_replace(regexp_replace(url, '^https?://(www\\.)?', '', 'i'),
              '[)\\].,;]+$', ''), '/+$', '')) = ANY($1::text[])
        ORDER BY first_seen DESC NULLS LAST
        LIMIT 1`,
      [[key, legacyUrlKey(normalized)]],
    );
    return {
      url: normalized,
      tracked: null,
      seen: seen[0]
        ? {
            company: String(seen[0].company ?? ''),
            title: String(seen[0].title ?? ''),
            status: String(seen[0].status ?? ''),
            firstSeen: seen[0].first_seen ?? null,
          }
        : null,
    };
  }

  async function check(body) {
    onlyKeys(body, ['url']);
    if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > MAX_URL)
      throw invalid('url');
    return guarded(() => lookup(body.url));
  }

  async function companies(input) {
    const raw = typeof input?.q === 'string' ? input.q.trim() : '';
    if (!raw || [...raw].length > 100) throw invalid('q');
    const key = compact(raw);
    if (!key) return { companies: [] };
    return guarded(async () => {
      const rows = await query(
        `SELECT DISTINCT trim(company) AS company FROM jobs WHERE trim(company) <> ''
         UNION
         SELECT DISTINCT trim(company) AS company FROM scan_history WHERE trim(company) <> ''
         LIMIT 5000`,
      );
      const seen = new Set();
      const matches = [];
      for (const row of rows) {
        const name = String(row.company ?? '').trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        if (!compact(name).startsWith(key)) continue;
        seen.add(name.toLowerCase());
        matches.push(name);
      }
      matches.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
      return { companies: matches.slice(0, MAX_SUGGESTIONS) };
    });
  }

  function validatePayload(body) {
    onlyKeys(body, ['url', 'company', 'role', 'text', 'force']);
    if (typeof body.url !== 'string' || body.url.length > MAX_URL) throw invalid('url');
    if (typeof body.company !== 'string' || [...body.company].length > MAX_FIELD)
      throw invalid('company');
    if (typeof body.role !== 'string' || [...body.role].length > MAX_FIELD) throw invalid('role');
    if (typeof body.text !== 'string' || Buffer.byteLength(body.text, 'utf8') > MAX_TEXT_BYTES)
      throw invalid('text', 'The job description is too large (2 MB limit).');
    if (body.force !== undefined && typeof body.force !== 'boolean') throw invalid('force');
    return {
      url: body.url,
      company: body.company,
      role: body.role,
      text: body.text,
      force: body.force === true,
    };
  }

  // Maps the launcher's fixed failure messages. Anything else is a generic failure.
  async function mapFailure(result, payload) {
    const message = String(result.stderr || '');
    if (/Invalid or missing job URL/.test(message))
      return invalid('url', 'Enter a full http or https address.');
    if (/Missing company name/.test(message)) return invalid('company', 'Enter the company name.');
    if (/Missing role title/.test(message)) return invalid('role', 'Enter the role title.');
    if (/Pasted JD text is too short/.test(message))
      return invalid('text', 'Paste the full job description (at least 100 characters).');
    if (/already belongs to a tracked job/.test(message)) {
      const found = await guarded(() => lookup(payload.url));
      return publicError(
        409,
        'DUPLICATE_JOB',
        'This URL already belongs to a tracked job.',
        undefined,
        { tracked: found.tracked },
      );
    }
    if (/seen in a past scan/.test(message)) {
      const found = await guarded(() => lookup(payload.url));
      return publicError(
        409,
        'SEEN_URL',
        'This URL was seen in a past scan but never tracked. Confirm to add it anyway.',
        undefined,
        { seen: found.seen },
      );
    }
    if (result.timedOut)
      return publicError(
        503,
        'INTAKE_TIMEOUT',
        'The intake took too long. Try again.',
        undefined,
        undefined,
        true,
      );
    return publicError(500, 'INTAKE_FAILED', 'The intake could not be completed.');
  }

  async function runLauncherFor(body, dryRun) {
    const payload = validatePayload(body);
    const result = await execute({
      command: process.execPath,
      args: [resolve(rootDir, ...SCRIPT), ...(dryRun ? ['--dry-run'] : [])],
      cwd: rootDir,
      input: JSON.stringify(payload),
      env,
      timeoutMs,
    });
    if (result.code !== 0) throw await mapFailure(result, payload);
    return { payload, stdout: String(result.stdout || '') };
  }

  // The launcher prints an absolute path; the browser gets it repo-relative.
  function relativePath(path) {
    if (typeof path !== 'string' || !path) return null;
    const absolute = isAbsolute(path) ? path : resolve(rootDir, path);
    const rel = relative(rootDir, absolute).replaceAll('\\', '/');
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : null;
  }

  async function preview(body) {
    const { stdout } = await runLauncherFor(body, true);
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '');
    } catch {
      throw publicError(500, 'INTAKE_FAILED', 'The intake could not be completed.');
    }
    const jdPath = relativePath(parsed?.jd_path);
    if (
      parsed?.mode !== 'dry-run' ||
      !jdPath ||
      typeof parsed.company !== 'string' ||
      typeof parsed.role !== 'string' ||
      typeof parsed.url !== 'string'
    )
      throw publicError(500, 'INTAKE_FAILED', 'The intake could not be completed.');
    return { company: parsed.company, role: parsed.role, url: parsed.url, jdPath };
  }

  async function add(body) {
    // Real intakes are serialized with scans: the in-process lock covers the intake itself and
    // a running scan is found through its run row.
    const release = discoveryLock.tryAcquire('intake');
    if (!release) throw discoveryBusy(null);
    try {
      const active = await guarded(() => activeScanRunId());
      if (active) throw discoveryBusy(active);
      const { payload, stdout } = await runLauncherFor(body, false);
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
      const head = /^Added #([0-9]+) — (.*) \((.*); JD saved verbatim\)$/.exec(line);
      if (!head) {
        // The launcher succeeded but its line was not the expected one: the job exists, so find it
        // by its normalized URL (the same lookup check uses) instead of reporting a failure.
        const found = await guarded(async () => {
          const result = await lookup(payload.url);
          if (!result.tracked) return null;
          const [row] = await query('SELECT jd_path FROM jobs WHERE id = $1::bigint', [
            result.tracked.id,
          ]);
          return { tracked: result.tracked, jdPath: relativePath(row?.jd_path) };
        });
        if (!found) throw publicError(500, 'INTAKE_FAILED', 'The intake could not be completed.');
        return {
          id: found.tracked.id,
          company: found.tracked.company,
          role: found.tracked.role,
          jdPath: found.jdPath ?? '',
        };
      }
      const suffix = ` — ${payload.role.trim()}`;
      const rest = head[2];
      const company = rest.endsWith(suffix) ? rest.slice(0, -suffix.length) : rest.split(' — ')[0];
      const jdPath = relativePath(head[3]);
      if (!jdPath) throw publicError(500, 'INTAKE_FAILED', 'The intake could not be completed.');
      return { id: head[1], company, role: payload.role.trim(), jdPath };
    } finally {
      release();
    }
  }

  return Object.freeze({ check, companies, preview, add });
}
