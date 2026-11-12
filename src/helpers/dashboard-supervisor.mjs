#!/usr/bin/env node
// Keeps the browser dashboard server running in the background (package 4.4a). Started hidden by
// Start-Dashboard.ps1 (-Up, -Restart) and by the logon task (-Install). It waits for the database,
// starts `node src/server/start.mjs`, restarts it with a backoff when it dies, and gives up after
// repeated failures. It owns logs/dashboard/web-server.json while it runs. It never signals
// detached workers and holds no secret: the server reads .env itself.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import root from '../lib/root.mjs';

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP = 3;
export const DB_WAIT_MS = 5 * 60 * 1000;
export const DB_PROBE_INTERVAL_MS = 5000;
export const FAILURE_LIMIT = 5;
export const FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_BACKOFF_MS = 30000;

// Rotates file -> file.1 -> file.2 when file is over maxBytes, keeping `keep` files in all
// (file, file.1, file.2 for keep = 3). Returns true when it rotated.
export function rotateLog(file, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  const oldest = `${file}.${keep - 1}`;
  try {
    unlinkSync(oldest);
  } catch {
    /* none to drop */
  }
  for (let i = keep - 2; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {
      /* gap in the chain */
    }
  }
  renameSync(file, `${file}.1`);
  return true;
}

// Restart policy: a failed run is retried after a growing delay, and after `limit` failures
// inside `windowMs` the caller must stop retrying. Pure, so it is unit tested.
export function createRestartPolicy({
  limit = FAILURE_LIMIT,
  windowMs = FAILURE_WINDOW_MS,
  baseDelayMs = 3000,
  maxDelayMs = MAX_BACKOFF_MS,
} = {}) {
  let failures = [];
  return {
    recordFailure(now = Date.now()) {
      failures = failures.filter(t => now - t < windowMs);
      failures.push(now);
      if (failures.length >= limit) return { giveUp: true, delayMs: 0, failures: failures.length };
      return {
        giveUp: false,
        delayMs: Math.min(maxDelayMs, baseDelayMs * failures.length),
        failures: failures.length,
      };
    },
  };
}

// Arguments for the server process. The first start builds the frontend (so -Up and -Restart
// serve the newest code); a restart after a crash reuses the existing build so the build stamp
// does not change and open tabs do not show the reload banner. Without a build it must build.
export function serverArgs({ first, distExists }) {
  return first || !distExists ? ['--no-open'] : ['--no-open', '--no-build'];
}

export function parseArgs(argv, env = process.env) {
  let port = env.PORT && /^\d{1,5}$/.test(env.PORT) ? Number(env.PORT) : 4310;
  const index = argv.indexOf('--port');
  if (index >= 0) {
    const value = argv[index + 1];
    if (!/^\d{1,5}$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535)
      throw new Error('--port must be an integer from 1 to 65535.');
    port = Number(value);
  }
  if (port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  return { port };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function portFree(port) {
  const probe = createServer();
  try {
    await new Promise((resolveListen, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolveListen);
    });
    await new Promise(r => probe.close(r));
    return true;
  } catch {
    return false;
  }
}

// One connection attempt. Returns 'up', 'down' (unreachable) or 'config' (not configured).
async function probeDatabase() {
  let client;
  try {
    const [{ default: pg }, { databaseConfig }] = await Promise.all([
      import('pg'),
      import('../lib/_database.mjs'),
    ]);
    client = new pg.Client({ ...databaseConfig(), connectionTimeoutMillis: 3000 });
    client.on('error', () => {});
    await client.connect();
    await client.query('SELECT 1');
    return 'up';
  } catch (error) {
    return String(error?.message ?? '').startsWith('Database not configured') ? 'config' : 'down';
  } finally {
    await client?.end().catch(() => {});
  }
}

async function main() {
  const { port } = parseArgs(process.argv.slice(2));
  const logDir = join(root, 'logs', 'dashboard');
  const logFile = join(logDir, 'server.log');
  const recordFile = join(logDir, 'web-server.json');
  mkdirSync(logDir, { recursive: true });
  const log = text => {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] supervisor: ${text}\n`);
    } catch {
      /* logging must never stop the supervisor */
    }
  };
  const supervisorStartedUtc = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const record = {
    pid: null,
    startedUtc: null,
    supervisorPid: process.pid,
    supervisorStartedUtc,
    port,
    state: 'starting',
  };
  const save = fields => {
    Object.assign(record, fields);
    const temporary = recordFile + '.' + process.pid + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(record));
      renameSync(temporary, recordFile);
    } catch {
      try {
        unlinkSync(temporary);
      } catch {
        /* nothing to clean */
      }
    }
  };

  // One supervisor at a time: a live, recorded supervisor means this start is a duplicate.
  try {
    const existing = JSON.parse(readFileSync(recordFile, 'utf8'));
    if (existing.supervisorPid && existing.supervisorPid !== process.pid) {
      try {
        process.kill(existing.supervisorPid, 0);
        const { readProcessStartTime } = await import('../server/runs.mjs');
        const actual = await readProcessStartTime(existing.supervisorPid);
        const recorded = Date.parse(existing.supervisorStartedUtc);
        if (!actual || Math.abs(actual.getTime() - recorded) <= 5000) {
          log(`another supervisor (pid ${existing.supervisorPid}) is already running; exiting`);
          return 0;
        }
      } catch {
        /* recorded supervisor is gone */
      }
    }
  } catch {
    /* no usable record */
  }

  let child = null;
  let stopping = false;
  const stop = signal => {
    stopping = true;
    log(`received ${signal}; stopping the server`);
    if (child?.pid) {
      try {
        process.kill(child.pid);
      } catch {
        /* already gone */
      }
    }
    try {
      unlinkSync(recordFile);
    } catch {
      /* already removed */
    }
    process.exit(0);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  log(`started (pid ${process.pid}), port ${port}`);
  save({ state: 'waiting-database' });
  const waitUntil = Date.now() + DB_WAIT_MS;
  for (;;) {
    const result = await probeDatabase();
    if (result === 'up') break;
    if (result === 'config') {
      log('database is not configured; starting anyway (the readiness card will say so)');
      break;
    }
    if (Date.now() >= waitUntil) {
      log('database still unreachable after 5 minutes; starting anyway');
      break;
    }
    await sleep(DB_PROBE_INTERVAL_MS);
  }

  const policy = createRestartPolicy();
  const entry = join(root, 'src', 'server', 'start.mjs');
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  let first = true;
  const distIndex = join(root, 'web', 'dist', 'index.html');
  while (!stopping) {
    rotateLog(logFile);
    let failed = 'server exited';
    if (!(await portFree(port))) {
      failed = `port ${port} is in use by another program`;
    } else {
      const fd = openSync(logFile, 'a');
      try {
        child = spawn(
          process.execPath,
          [entry, ...serverArgs({ first, distExists: existsSync(distIndex) })],
          {
            cwd: root,
            env: {
              ...process.env,
              PORT: String(port),
              ...(existsSync(npmCli) && !process.env.npm_execpath ? { npm_execpath: npmCli } : {}),
            },
            stdio: ['ignore', fd, fd],
            windowsHide: true,
          },
        );
      } finally {
        closeSync(fd);
      }
      first = false;
      const exited = new Promise(resolveExit => {
        child.once('error', error => resolveExit({ code: null, error }));
        child.once('exit', code => resolveExit({ code }));
      });
      save({ pid: child.pid, startedUtc: new Date().toISOString(), state: 'running' });
      log(`server started (pid ${child.pid})`);
      const outcome = await exited;
      failed = outcome.error
        ? `could not start the server (${outcome.error.code ?? 'error'})`
        : `server exited (code ${outcome.code})`;
      child = null;
      save({ pid: null, startedUtc: null });
    }
    if (stopping) break;
    const verdict = policy.recordFailure();
    if (verdict.giveUp) {
      log(
        `${failed}; ${verdict.failures} failures within 10 minutes, giving up. ` +
          'Fix the cause and run npm run web:up.',
      );
      save({ state: 'gave-up' });
      return 0;
    }
    log(`${failed}; restarting in ${verdict.delayMs / 1000}s (failure ${verdict.failures})`);
    save({ state: 'backoff' });
    await sleep(verdict.delayMs);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main().catch(error => {
    console.error(error.message);
    return 1;
  });
}
