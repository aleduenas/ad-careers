import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { startService, parsePort } from './start.mjs';
import { DatabaseUnavailableError } from './readiness.mjs';

async function createOwnedTemp(prefix) {
  const created = await mkdtemp(join(tmpdir(), prefix));
  const absolute = resolve(created);
  const canonical = await realpath(absolute);
  assert.equal(canonical.toLowerCase(), absolute.toLowerCase());
  assert.equal((await lstat(absolute)).isSymbolicLink(), false);
  return absolute;
}

async function cleanupOwnedTemp(path) {
  const tempRoot = await realpath(tmpdir());
  const canonical = await realpath(path);
  assert.equal(canonical.toLowerCase(), path.toLowerCase());
  assert.equal((await lstat(path)).isSymbolicLink(), false);
  const rel = resolve(tempRoot, '..'); // Keep containment check below based on resolved relative path.
  void rel;
  const relativePath = canonical.slice(tempRoot.length).replace(/^[/\\]+/, '');
  assert.ok(relativePath && !relativePath.startsWith('..'));
  await rm(path, { recursive: true, force: true });
}

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

test('validates ports and starts/stops an isolated server using injected readiness and opener', async t => {
  assert.equal(parsePort('4310'), 4310);
  for (const bad of ['0', '65536', '-1', '4x', '']) assert.throws(() => parsePort(bad), /PORT/);
  const workspace = await createOwnedTemp('career startup space ');
  t.after(async () => cleanupOwnedTemp(workspace));
  await mkdir(resolve(workspace, 'web', 'dist'), { recursive: true });
  await writeFile(resolve(workspace, 'web', 'dist', 'index.html'), '<main>built</main>');
  const reservation = createServer();
  await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));
  let opened = 0;
  const service = await startService({
    port,
    rootDir: workspace,
    build: false,
    noOpen: false,
    readiness: async () => {
      throw new DatabaseUnavailableError();
    },
    jobsReader: {
      list: async query => ({
        items: [],
        totalCount: 0,
        nextCursor: null,
        previousCursor: null,
        query: { q: '', filter: 'all', sort: 'score', direction: 'desc', grouped: true, limit: 50 },
      }),
      overview: async () => ({
        label: 'inferredFromCurrentState',
        metrics: {
          total: 0,
          actionable: 0,
          byStatus: {
            Evaluated: 0,
            Applied: 0,
            Interview: 0,
            Offer: 0,
            Rejected: 0,
            Discarded: 0,
            Ghosted: 0,
          },
          avgScore: null,
          topScore: null,
        },
        progress: {
          funnel: [
            { label: 'Evaluated', count: 0, percent: 100 },
            { label: 'Applied', count: 0, percent: 0 },
            { label: 'Responded', count: 0, percent: 0 },
            { label: 'Interview', count: 0, percent: 0 },
            { label: 'Offer', count: 0, percent: 0 },
          ],
          responseRate: 0,
          interviewRate: 0,
          offerRate: 0,
          scoreBuckets: [
            { label: '4.5-5.0', count: 0 },
            { label: '4.0-4.4', count: 0 },
            { label: '3.5-3.9', count: 0 },
            { label: '3.0-3.4', count: 0 },
            { label: '  <3.0', count: 0 },
          ],
          weeklyActivity: [],
        },
      }),
    },
    openUrl: async url => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/#\/overview$/);
      opened++;
    },
  });
  t.after(() => service.close());
  assert.equal(opened, 1);
  const health = await fetch(`http://127.0.0.1:${service.app.server.address().port}/api/v1/health`);
  assert.equal(health.status, 200);
  const jobs = await fetch(`http://127.0.0.1:${service.app.server.address().port}/api/v1/jobs`);
  assert.equal(jobs.status, 200);
  assert.equal((await jobs.json()).data.totalCount, 0);
  const ready = await fetch(`http://127.0.0.1:${service.app.server.address().port}/api/v1/ready`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).error.code, 'DATABASE_UNAVAILABLE');
  await service.close();
  const noOpenService = await startService({
    port: await freePort(),
    rootDir: workspace,
    build: false,
    noOpen: true,
    openUrl: async () => {
      throw new Error('no-open must not launch a browser');
    },
    readiness: async () => {},
  });
  await noOpenService.close();
  const failedOpenPort = await freePort();
  await assert.rejects(
    startService({
      port: failedOpenPort,
      rootDir: workspace,
      build: false,
      readiness: async () => {},
      openUrl: async () => {
        throw new Error('injected opener failure');
      },
    }),
    /injected opener failure/,
  );
  const released = createServer();
  await new Promise((resolveListen, reject) => {
    released.once('error', reject);
    released.listen(failedOpenPort, '127.0.0.1', resolveListen);
  });
  await new Promise(resolveClose => released.close(resolveClose));
  const occupied = createServer();
  await new Promise(resolveListen => occupied.listen(0, '127.0.0.1', resolveListen));
  const occupiedPort = occupied.address().port;
  try {
    await assert.rejects(
      startService({ port: occupiedPort, rootDir: workspace, build: false, noOpen: true }),
      /already in use/,
    );
  } finally {
    await new Promise(resolveClose => occupied.close(resolveClose));
  }
});

test('missing build fails with a safe prerequisite message', async t => {
  const workspace = await createOwnedTemp('career-unbuilt-');
  t.after(async () => cleanupOwnedTemp(workspace));
  await mkdir(resolve(workspace, 'web'), { recursive: true });
  await assert.rejects(
    startService({ rootDir: workspace, port: await freePort(), build: false, noOpen: true }),
    /Web build is missing/,
  );
});

test('missing dependencies fail before npm build invocation', async t => {
  const workspace = await createOwnedTemp('career-no-deps-');
  t.after(async () => cleanupOwnedTemp(workspace));
  await assert.rejects(
    startService({ rootDir: workspace, port: await freePort(), noOpen: true }),
    /Dependencies are missing/,
  );
});

test('interrupted build stops only its injected owned process tree', async t => {
  const workspace = await createOwnedTemp('career-build-space ');
  t.after(async () => cleanupOwnedTemp(workspace));
  await mkdir(resolve(workspace, 'node_modules', 'vite', 'bin'), { recursive: true });
  await mkdir(resolve(workspace, 'node_modules', 'npm', 'bin'), { recursive: true });
  await mkdir(resolve(workspace, 'node_modules', 'fastify'), { recursive: true });
  await writeFile(resolve(workspace, 'node_modules', 'vite', 'bin', 'vite.js'), '');
  await writeFile(resolve(workspace, 'node_modules', 'npm', 'bin', 'npm-cli.js'), '');
  await writeFile(resolve(workspace, 'node_modules', 'fastify', 'package.json'), '{}');
  let stopped = 0;
  const operation = startService({
    rootDir: workspace,
    port: await freePort(),
    spawnProcess: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.equal(args.at(-2), 'run');
      assert.equal(args.at(-1), 'web:build');
      assert.equal(args.length, 3);
      assert.match(args[0], /npm-cli\.js$/);
      assert.equal(options.cwd, workspace);
      assert.equal(options.windowsHide, true);
      const child = new EventEmitter();
      child.pid = 812345;
      child.kill = () => {
        stopped++;
        setImmediate(() => child.emit('exit', null));
      };
      setImmediate(() => process.emit('SIGINT'));
      return child;
    },
    stopProcessTree: child => child.kill(),
  });
  await assert.rejects(operation, /interrupted during the frontend build/);
  assert.equal(stopped, 1);
});
