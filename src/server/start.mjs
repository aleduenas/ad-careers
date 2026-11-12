#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import root from '../lib/root.mjs';
import { createStaticHandler } from './static.mjs';

const DEFAULT_PORT = 4310;
const PORT_PATTERN = /^\d{1,5}$/;

export function parsePort(value = String(DEFAULT_PORT)) {
  if (!PORT_PATTERN.test(String(value)))
    throw new TypeError('PORT must be an integer from 1 to 65535.');
  const port = Number(value);
  if (port < 1 || port > 65535) throw new TypeError('PORT must be an integer from 1 to 65535.');
  return port;
}

export async function startService({
  port = DEFAULT_PORT,
  noOpen = false,
  rootDir = root,
  readiness,
  jobsReader,
  jobDetailReader,
  jobsWriter,
  runsService,
  intakeService,
  providersService,
  letterService,
  openUrl = defaultOpenUrl,
  spawnProcess = spawn,
  stopProcessTree = stopOwnedProcessTree,
  build = true,
  logger = false,
} = {}) {
  const actualPort = parsePort(port);
  const canonicalRoot = await realpath(rootDir);
  const distDir = resolve(canonicalRoot, 'web', 'dist');
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', error =>
      reject(
        error.code === 'EADDRINUSE' ? new Error(`Port ${actualPort} is already in use.`) : error,
      ),
    );
    probe.listen(actualPort, '127.0.0.1', resolveListen);
  });
  await new Promise(resolveClose => probe.close(resolveClose));
  if (build) await runBuild(canonicalRoot, spawnProcess, stopProcessTree);
  try {
    await access(resolve(distDir, 'index.html'));
  } catch {
    throw new Error('Web build is missing. Run npm run web:build.');
  }
  // Build stamp: mtime of the served index.html, computed once; the page compares it with its own.
  let buildStamp = 'dev';
  try {
    buildStamp = (await stat(resolve(distDir, 'index.html'))).mtime.toISOString();
  } catch {}
  const { createApp } = await import('./app.mjs');
  const host = `127.0.0.1:${actualPort}`;
  const app = createApp({
    host,
    origin: `http://${host}`,
    buildStamp,
    ...(readiness ? { readiness } : {}),
    ...(jobsReader ? { jobsReader } : {}),
    ...(jobDetailReader ? { jobDetailReader } : {}),
    ...(jobsWriter ? { jobsWriter } : {}),
    ...(runsService !== undefined ? { runsService } : {}),
    ...(intakeService !== undefined ? { intakeService } : {}),
    ...(providersService !== undefined ? { providersService } : {}),
    ...(letterService !== undefined ? { letterService } : {}),
    logger,
    staticHandler: createStaticHandler({ distDir }),
  });
  try {
    await app.listen({ host: '127.0.0.1', port: actualPort });
  } catch (error) {
    await app.close();
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${actualPort} is already in use.`);
    throw error;
  }
  const url = `http://${host}/#/overview`;
  if (!noOpen) {
    try {
      await openUrl(url);
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  let closing;
  const close = () => (closing ||= app.close());
  return { app, url, close };
}

export async function runBuild(cwd, spawnProcess = spawn, stopProcessTree = stopOwnedProcessTree) {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Node.js 24 or newer is required.');
  try {
    await access(resolve(cwd, 'node_modules', 'vite', 'bin', 'vite.js'));
    await access(resolve(cwd, 'node_modules', 'fastify', 'package.json'));
  } catch {
    throw new Error('Dependencies are missing. Run npm install first.');
  }
  const npm = await locateNpmCli(cwd);
  await new Promise((resolveBuild, reject) => {
    const child = spawnProcess(process.execPath, [npm, 'run', 'web:build'], {
      cwd,
      windowsHide: true,
      stdio: 'inherit',
    });
    let signal;
    const stopChild = () => {
      signal = true;
      stopProcessTree(child);
    };
    const cleanup = () => {
      process.removeListener('SIGINT', stopChild);
      process.removeListener('SIGTERM', stopChild);
    };
    process.once('SIGINT', stopChild);
    process.once('SIGTERM', stopChild);
    child.once('error', error => {
      cleanup();
      reject(error);
    });
    child.once('exit', code => {
      cleanup();
      if (signal) reject(new Error('Startup was interrupted during the frontend build.'));
      else if (code === 0) resolveBuild();
      else reject(new Error(`Frontend build failed (exit ${code ?? 'signal'}).`));
    });
  });
}

export function stopOwnedProcessTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 3000,
    });
  }
  child.kill('SIGKILL');
}

// Finds npm's JavaScript entry point (it is started as `node <cli> run ...`, never through a shell).
// Order: npm_execpath (set when started by npm), a copy under the repository, the npm installed
// beside the node binary, then npm found on PATH (its cli sits next to the launcher on Windows, or
// under ../lib/node_modules next to the real launcher on Unix).
export async function locateNpmCli(
  cwd,
  { env = process.env, execPath = process.execPath, platform = process.platform } = {},
) {
  const cli = ['node_modules', 'npm', 'bin', 'npm-cli.js'];
  const candidates = [
    env.npm_execpath,
    resolve(cwd, ...cli),
    resolve(dirname(execPath), ...cli),
    resolve(dirname(execPath), '..', 'lib', ...cli),
  ];
  const names = platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm'];
  for (const directory of String(env.PATH ?? env.Path ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)) {
    for (const name of names) {
      const launcher = join(directory, name);
      try {
        await access(launcher);
      } catch {
        continue;
      }
      candidates.push(resolve(directory, ...cli));
      try {
        candidates.push(resolve(dirname(await realpath(launcher)), '..', 'lib', ...cli));
        candidates.push(resolve(dirname(await realpath(launcher)), '..', ...cli));
      } catch {
        /* the launcher cannot be resolved */
      }
    }
  }
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate);
      return resolve(candidate);
    } catch {
      /* check next known launcher */
    }
  }
  throw new Error('npm launcher is unavailable; install npm or run npm from the repository root.');
}

async function defaultOpenUrl(url) {
  const { platform } = process;
  const command = platform === 'win32' ? 'cmd.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/d', '/s', '/c', 'start', '""', url] : [url];
  await new Promise((resolveOpen, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolveOpen() : reject(new Error('Could not open the local dashboard.')),
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let service;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (service) {
      await service.close();
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    service = await startService({
      port: process.env.PORT || DEFAULT_PORT,
      noOpen: process.argv.includes('--no-open'),
      build: !process.argv.includes('--no-build'),
    });
    if (stopping) {
      await service.close();
      process.exit(0);
    }
    console.log(`Career-ops web dashboard listening at ${service.url}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (!service || stopping) {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    }
  }
}
