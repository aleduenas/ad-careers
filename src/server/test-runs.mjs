import assert from 'node:assert/strict';
import { spawn as realSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import {
  createDiscoveryLock,
  createProviderCheck,
  createRunsService,
  LAUNCHERS,
  projectScanReport,
  readProcessStartTime,
  redactLog,
  START_TIME_TOLERANCE_MS,
  toWireRun,
} from './runs.mjs';
import { RunsStoreError } from './runs-store.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

// In-memory stand-in for runs-store.mjs with the same once-only, forward-only semantics as the
// SQL functions (those are covered against PostgreSQL by test-runs-database.mjs).
function memoryStore() {
  const rows = new Map();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 10, 12, 0, clock++)).toISOString();
  const store = {
    rows,
    async insert({ id, requestKey, groupId, action, jobId, logRef, selection }) {
      for (const row of rows.values())
        if (row.requestKey === requestKey)
          throw new RunsStoreError('REQUEST_KEY_CONFLICT', 'Run request key already used');
      const run = {
        id: id || crypto.randomUUID(),
        requestKey,
        groupId: groupId ?? null,
        action,
        jobId: jobId ?? null,
        state: 'queued',
        phase: 'queued',
        attempt: 1,
        pid: null,
        pidStartedAt: null,
        exitCode: null,
        errorCode: null,
        logRef,
        selection: selection ?? {},
        createdAt: stamp(),
        startedAt: null,
        updatedAt: stamp(),
        finishedAt: null,
      };
      rows.set(run.id, run);
      return { ...run };
    },
    async start(id, pid, at) {
      const run = rows.get(id);
      if (run.state === 'queued') {
        Object.assign(run, {
          state: 'running',
          phase: 'running',
          pid,
          pidStartedAt: new Date(at).toISOString(),
          startedAt: new Date(at).toISOString(),
        });
      }
      return { ...run };
    },
    async report(id, phase, attempt) {
      const run = rows.get(id);
      if (run.state === 'running' && attempt >= run.attempt) Object.assign(run, { phase, attempt });
      return { ...run };
    },
    async finish(id, state, exitCode, errorCode) {
      const run = rows.get(id);
      if (run.state === 'queued' || run.state === 'running')
        Object.assign(run, { state, exitCode, errorCode, finishedAt: stamp() });
      return { ...run };
    },
    async interruptStale({ deadPids = [], now = new Date() } = {}) {
      const changed = [];
      for (const run of rows.values()) {
        if (run.state !== 'running') continue;
        const dead = deadPids.includes(run.pid);
        const stale = new Date(run.startedAt) < new Date(now.getTime() - 24 * 3600 * 1000);
        if (dead || stale) {
          Object.assign(run, {
            state: 'interrupted',
            errorCode: dead ? 'PROCESS_GONE' : 'STALE_24H',
            finishedAt: stamp(),
          });
          changed.push({ ...run });
        }
      }
      return changed;
    },
    async list({ jobId, limit = 12 } = {}) {
      const all = [...rows.values()].filter(run => !jobId || run.jobId === jobId);
      const active = all.filter(run => run.state === 'queued' || run.state === 'running');
      const terminal = all.filter(run => !active.includes(run)).slice(-limit || undefined);
      return [...active, ...(limit === 0 ? [] : terminal)].map(run => ({ ...run }));
    },
    async listByGroup(groupId) {
      return [...rows.values()].filter(run => run.groupId === groupId).map(run => ({ ...run }));
    },
    async get(id) {
      const run = rows.get(id);
      return run ? { ...run } : null;
    },
    async getByRequestKey(key) {
      const run = [...rows.values()].find(row => row.requestKey === key);
      return run ? { ...run } : null;
    },
  };
  return store;
}

const SYNTHETIC = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const reportFlag = process.argv.find(arg => arg.startsWith('--report-json='));
if (reportFlag && process.env.SYNTH_REPORT) {
  const target = resolve(reportFlag.slice('--report-json='.length));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, process.env.SYNTH_REPORT);
}
const mode = process.env.SYNTH_MODE || 'ok';
console.log('args=' + process.argv.slice(2).join(' '));
console.log('run=' + process.env.CAREER_RUN_ID);
console.log('task=' + (process.env.CAREER_TASK_FILE ? 'set' : 'missing'));
console.log('OPENAI_API_KEY=sk-live-0123456789abcdef0123456789abcdef');
if (mode === 'fail') process.exit(3);
if (mode === 'sleep') setInterval(() => {}, 1000);
`;

async function withRoot(callback, { scripts = true } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'career-ops-runs-'));
  try {
    if (scripts)
      for (const parts of Object.values(LAUNCHERS)) {
        await mkdir(join(rootDir, ...parts.slice(0, -1)), { recursive: true });
        await writeFile(join(rootDir, ...parts), SYNTHETIC);
      }
    await callback(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 });
  }
}

function makeService(rootDir, overrides = {}) {
  const { spawn: innerSpawn = realSpawn, store = memoryStore(), ...rest } = overrides;
  const spawned = [];
  const service = createRunsService({
    store,
    rootDir,
    spawn: (...args) => {
      spawned.push(args);
      return innerSpawn(...args);
    },
    findJob: async id => (id === '404' ? null : { id, status: 'Evaluated' }),
    checkProvider: async provider => ({ available: true, command: provider }),
    ...rest,
  });
  return { service, store, spawned };
}

async function until(check, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function rejects(promise, statusCode, code, field) {
  await assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode, error.message);
    assert.equal(error.publicCode, code);
    if (field) assert.deepEqual(Object.keys(error.fields), [field]);
    return true;
  });
}

test('dispatch spawns the allowlisted launcher by argv, records the run and its log', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const { service, store, spawned } = makeService(rootDir);
    const created = await service.dispatch({ action: 'evaluate', jobId: '12', requestKey: 'k-1' });
    assert.equal(created.replayed, false);
    assert.equal(created.runs.length, 1);
    const [run] = created.runs;
    assert.deepEqual(
      [run.action, run.jobId, run.state, run.source, run.groupId],
      ['evaluate', '12', 'running', 'browser', null],
    );
    assert.deepEqual(Object.keys(run).sort(), [
      'action',
      'attempt',
      'createdAt',
      'errorCode',
      'exitCode',
      'finishedAt',
      'groupId',
      'id',
      'jobId',
      'phase',
      'requestKey',
      'selection',
      'source',
      'startedAt',
      'state',
      'updatedAt',
    ]);
    // argv, options and environment mirror the TUI launch.
    const [command, args, options] = spawned[0];
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [join(rootDir, ...LAUNCHERS.evaluate), '--job=12']);
    assert.equal(options.cwd, rootDir);
    assert.equal(options.detached, true);
    assert.equal(options.windowsHide, true);
    assert.equal(options.env.CAREER_RUN_ID, run.id);
    assert.ok(options.env.CAREER_TASK_FILE.includes(join('logs', 'dashboard', 'tasks')));
    assert.equal(options.shell, undefined, 'no shell');
    // pid and start time are recorded; the exit observer ends the run truthfully.
    const row = store.rows.get(run.id);
    assert.ok(Number.isInteger(row.pid) && row.pid > 0);
    assert.ok(row.pidStartedAt);
    const done = await until(async () => {
      const current = await store.get(run.id);
      return current.state === 'completed' ? current : null;
    }, 'completion');
    assert.equal(done.exitCode, 0);
    const log = await readFile(join(rootDir, 'logs', 'dashboard', row.logRef), 'utf8');
    assert.match(log, /args=--job=12/);
    assert.match(log, new RegExp(`run=${run.id}`));
    // The legacy task record exists for the TUI monitor.
    const record = JSON.parse(
      await readFile(
        join(rootDir, 'logs', 'dashboard', 'tasks', row.logRef.replace(/\.log$/, '.json')),
        'utf8',
      ),
    );
    assert.equal(record.action, 'evaluate');
    assert.equal(record.number, 12);
    assert.equal(record.pid, row.pid);
  });
});

test('a failing worker ends failed with its exit code', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'fail';
    const { service, store } = makeService(rootDir);
    const { runs } = await service.dispatch({ action: 'cv', jobId: '5', requestKey: 'k-fail' });
    const done = await until(async () => {
      const current = await store.get(runs[0].id);
      return current.state === 'failed' ? current : null;
    }, 'failure');
    assert.equal(done.exitCode, 3);
    assert.equal(done.errorCode, 'EXIT_NONZERO');
  });
});

test('duplicate request key: same digest replays, anything else is 409', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const { service, spawned } = makeService(rootDir);
    const first = await service.dispatch({ action: 'letter', jobId: '7', requestKey: 'dup' });
    const again = await service.dispatch({ action: 'letter', jobId: '7', requestKey: 'dup' });
    assert.equal(again.replayed, true);
    assert.equal(again.runs[0].id, first.runs[0].id);
    assert.equal(spawned.length, 1, 'a replay never spawns a second worker');
    await rejects(
      service.dispatch({ action: 'letter', jobId: '8', requestKey: 'dup' }),
      409,
      'REQUEST_KEY_CONFLICT',
    );
    await rejects(
      service.dispatch({ action: 'cv', jobId: '7', requestKey: 'dup' }),
      409,
      'REQUEST_KEY_CONFLICT',
    );
    assert.equal(spawned.length, 1);
  });
});

test('both starts two independent workers in one group with derived keys', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const { service, spawned } = makeService(rootDir);
    const { runs, replayed } = await service.dispatch({
      action: 'both',
      jobId: '9',
      requestKey: 'pair',
    });
    assert.equal(replayed, false);
    assert.deepEqual(runs.map(run => run.action).sort(), ['cv', 'letter']);
    assert.equal(runs[0].groupId, runs[1].groupId);
    assert.ok(runs[0].groupId);
    assert.deepEqual(runs.map(run => run.requestKey).sort(), ['pair:cv', 'pair:letter']);
    assert.equal(spawned.length, 2);
    const again = await service.dispatch({ action: 'both', jobId: '9', requestKey: 'pair' });
    assert.equal(again.replayed, true);
    assert.equal(spawned.length, 2);
  });
});

test('validation: action allowlist, job id, key, extra fields and unknown job', async () => {
  await withRoot(async rootDir => {
    const { service, spawned } = makeService(rootDir);
    const ok = { action: 'evaluate', jobId: '1', requestKey: 'valid-key' };
    await rejects(service.dispatch({ ...ok, action: 'intake' }), 400, 'INVALID_REQUEST', 'action');
    // publish is a real action now but needs the saved letter's hash.
    await rejects(
      service.dispatch({ ...ok, action: 'publish' }),
      400,
      'INVALID_REQUEST',
      'expectedHash',
    );
    await rejects(service.dispatch({ ...ok, action: 'rm -rf' }), 400, 'INVALID_REQUEST', 'action');
    for (const jobId of ['0', '01', 'abc', 5, null, '1'.repeat(20)])
      await rejects(service.dispatch({ ...ok, jobId }), 400, 'INVALID_REQUEST', 'jobId');
    for (const requestKey of ['', 'a b', 'a/b', 'x'.repeat(161), 5])
      await rejects(service.dispatch({ ...ok, requestKey }), 400, 'INVALID_REQUEST', 'requestKey');
    await rejects(
      service.dispatch({ ...ok, script: '../../evil.mjs' }),
      400,
      'INVALID_REQUEST',
      'script',
    );
    await rejects(service.dispatch(null), 400, 'INVALID_REQUEST', 'body');
    await rejects(service.dispatch({ ...ok, jobId: '404' }), 404, 'NOT_FOUND');
    assert.equal(spawned.length, 0, 'nothing is spawned for a rejected request');
  });
});

test('spawn failure ends failed SPAWN_FAILED: missing launcher, throw and async error', async () => {
  await withRoot(
    async rootDir => {
      const missing = makeService(rootDir);
      const one = await missing.service.dispatch({ action: 'cv', jobId: '3', requestKey: 's-1' });
      assert.deepEqual([one.runs[0].state, one.runs[0].errorCode], ['failed', 'SPAWN_FAILED']);
      assert.equal(missing.spawned.length, 0);
    },
    { scripts: false },
  );
  await withRoot(async rootDir => {
    const throwing = makeService(rootDir, {
      spawn: () => {
        throw new Error('spawn exploded with /private/path');
      },
    });
    const two = await throwing.service.dispatch({ action: 'cv', jobId: '3', requestKey: 's-2' });
    assert.deepEqual([two.runs[0].state, two.runs[0].errorCode], ['failed', 'SPAWN_FAILED']);
    assert.equal(JSON.stringify(two).includes('/private/path'), false);

    const asyncError = makeService(rootDir, {
      spawn: () => {
        const child = new EventEmitter();
        child.pid = undefined;
        child.unref = () => {};
        queueMicrotask(() => child.emit('error', new Error('ENOENT')));
        return child;
      },
    });
    const three = await asyncError.service.dispatch({
      action: 'letter',
      jobId: '3',
      requestKey: 's-3',
    });
    assert.deepEqual([three.runs[0].state, three.runs[0].errorCode], ['failed', 'SPAWN_FAILED']);
  });
});

async function seedRunning(store, overrides = {}) {
  const run = await store.insert({
    requestKey: overrides.requestKey || `seed-${Math.random()}`,
    action: 'evaluate',
    jobId: '1',
    logRef: overrides.logRef || `evaluate-1-seed-${Math.random().toString(16).slice(2)}.log`,
  });
  await store.start(run.id, overrides.pid ?? 424242, overrides.startedAt || new Date());
  return run;
}

test('reconcile interrupts dead pids and 24 h rows, keeps live ones, honours a finished record', async () => {
  await withRoot(async rootDir => {
    const store = memoryStore();
    const alive = new Set([111, 333]);
    const { service } = makeService(rootDir, { store, isAlive: pid => alive.has(pid) });
    const live = await seedRunning(store, { pid: 111 });
    const dead = await seedRunning(store, { pid: 222 });
    const old = await seedRunning(store, {
      pid: 333,
      startedAt: new Date(Date.now() - 25 * 3600 * 1000),
    });
    const finishedElsewhere = await seedRunning(store, { pid: 444, logRef: 'evaluate-1-rec.log' });
    await mkdir(join(rootDir, 'logs', 'dashboard', 'tasks'), { recursive: true });
    await writeFile(
      join(rootDir, 'logs', 'dashboard', 'tasks', 'evaluate-1-rec.json'),
      JSON.stringify({ state: 'completed', exit_code: 0 }),
    );
    const terminal = await store.insert({
      requestKey: 'done',
      action: 'cv',
      jobId: '1',
      logRef: 'cv-1-x.log',
    });
    await store.finish(terminal.id, 'completed', 0, null);

    const changed = await service.reconcile();
    assert.deepEqual(changed.map(run => run.id).sort(), [dead.id, old.id].sort());
    assert.equal((await store.get(live.id)).state, 'running');
    assert.deepEqual(
      [(await store.get(dead.id)).state, (await store.get(dead.id)).errorCode],
      ['interrupted', 'PROCESS_GONE'],
    );
    assert.deepEqual(
      [(await store.get(old.id)).state, (await store.get(old.id)).errorCode],
      ['interrupted', 'STALE_24H'],
    );
    const settled = await store.get(finishedElsewhere.id);
    assert.deepEqual([settled.state, settled.exitCode], ['completed', 0]);
    assert.equal((await store.get(terminal.id)).state, 'completed', 'terminal rows are untouched');
    assert.deepEqual(await service.reconcile(), [], 'a second pass changes nothing');
  });
});

test('a live pid with a different start time is a recycled pid; unreadable start time falls back to alive', async () => {
  await withRoot(async rootDir => {
    // Relative to now: a fixed date crosses the 24 h stale rule and turns every case into
    // "interrupted" (seen 2026-11-12).
    const startedAt = new Date(Date.now() - 60_000);
    const cases = [
      ['same start time', async () => startedAt, 'running'],
      ['within tolerance', async () => new Date(startedAt.getTime() + 1500), 'running'],
      [
        'just past tolerance',
        async () => new Date(startedAt.getTime() + START_TIME_TOLERANCE_MS + 1000),
        'interrupted',
      ],
      [
        'started an hour later',
        async () => new Date(startedAt.getTime() + 3600_000),
        'interrupted',
      ],
      ['unreadable (null)', async () => null, 'running'],
      [
        'probe throws',
        async () => {
          throw new Error('powershell failed');
        },
        'running',
      ],
    ];
    for (const [label, probe, expected] of cases) {
      const store = memoryStore();
      const { service } = makeService(rootDir, {
        store,
        isAlive: () => true,
        processStartTime: probe,
      });
      const run = await seedRunning(store, { pid: 31337, startedAt });
      await service.reconcile();
      const row = await store.get(run.id);
      assert.equal(row.state, expected, label);
      if (expected === 'interrupted') assert.equal(row.errorCode, 'PROCESS_GONE', label);
    }
    // A dead pid never reaches the probe.
    let probed = 0;
    const store = memoryStore();
    const { service } = makeService(rootDir, {
      store,
      isAlive: () => false,
      processStartTime: async () => (probed++, startedAt),
    });
    await seedRunning(store, { pid: 31338, startedAt });
    await service.reconcile();
    assert.equal(probed, 0);
  });
});

test('readProcessStartTime reads Windows start times through a bounded argv call only', async () => {
  const calls = [];
  const fake =
    (output, error = null) =>
    (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(error, output);
    };
  const stamp = await readProcessStartTime(4242, {
    platform: 'win32',
    run: fake('2026-11-10T12:00:00.1234567Z\r\n'),
  });
  assert.equal(stamp.toISOString(), '2026-11-10T12:00:00.123Z');
  assert.equal(calls[0].command, 'powershell.exe');
  assert.ok(calls[0].args.includes('-NoProfile'));
  assert.match(calls[0].args.at(-1), /Get-Process -Id 4242\)/);
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].options.timeout > 0 && calls[0].options.timeout <= 10000);
  assert.equal(calls[0].options.shell, undefined, 'no shell');
  assert.equal(
    await readProcessStartTime(4242, { platform: 'win32', run: fake('', new Error('x')) }),
    null,
  );
  assert.equal(
    await readProcessStartTime(4242, { platform: 'win32', run: fake('not a date') }),
    null,
  );
  assert.equal(
    await readProcessStartTime(4242, {
      platform: 'win32',
      run: () => {
        throw new Error('spawn');
      },
    }),
    null,
  );
  const before = calls.length;
  assert.equal(await readProcessStartTime(4242, { platform: 'linux', run: fake('x') }), null);
  for (const pid of [0, -1, 1.5, '12; calc', null])
    assert.equal(await readProcessStartTime(pid, { platform: 'win32', run: fake('x') }), null);
  assert.equal(calls.length, before, 'invalid pids and other platforms never spawn');
});

test('reconcile interrupts a queued row that never started, and leaves a fresh one', async () => {
  await withRoot(async rootDir => {
    const store = memoryStore();
    const old = await store.insert({
      requestKey: 'q-old',
      action: 'cv',
      jobId: '1',
      logRef: 'cv-1-q-old.log',
    });
    const fresh = await store.insert({
      requestKey: 'q-new',
      action: 'cv',
      jobId: '1',
      logRef: 'cv-1-q-new.log',
    });
    store.rows.get(fresh.id).createdAt = new Date(Date.now() - 60_000).toISOString();
    store.rows.get(old.id).createdAt = new Date(Date.now() - 6 * 60_000).toISOString();
    const { service } = makeService(rootDir, { store });
    const changed = await service.reconcile();
    assert.deepEqual(
      changed.map(run => [run.id, run.state, run.errorCode]),
      [[old.id, 'interrupted', 'QUEUE_STALE']],
    );
    assert.equal((await store.get(fresh.id)).state, 'queued');
    assert.deepEqual(await service.reconcile(), [], 'a second pass changes nothing');
  });
});

test('launch records the pid first and tracks the worker even when the start call fails', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const store = memoryStore();
    const order = [];
    const tracked = {
      ...store,
      insert: async (...args) => (order.push('insert'), store.insert(...args)),
      start: async (...args) => (order.push('start'), store.start(...args)),
      finish: async (...args) => (order.push('finish'), store.finish(...args)),
    };
    const first = makeService(rootDir, {
      store: tracked,
      spawn: (...args) => (order.push('spawn'), realSpawn(...args)),
    });
    const created = await first.service.dispatch({
      action: 'cv',
      jobId: '4',
      requestKey: 'order-1',
    });
    assert.deepEqual(
      order.slice(0, 3),
      ['insert', 'spawn', 'start'],
      'pid is recorded right after spawn',
    );
    assert.equal(created.runs[0].state, 'running');
    await until(
      async () => (await store.get(created.runs[0].id)).state === 'completed',
      'completion',
    );

    // A failing start call must not leave the worker untracked: the run stays queued, the
    // exit is still observed, and the response does not throw.
    const errors = [];
    const failingStart = {
      ...store,
      start: async () => {
        throw new Error('database went away');
      },
    };
    const second = makeService(rootDir, {
      store: failingStart,
      onError: error => errors.push(error),
    });
    const result = await second.service.dispatch({
      action: 'cv',
      jobId: '4',
      requestKey: 'order-2',
    });
    assert.equal(result.runs[0].state, 'queued');
    assert.ok(errors.some(error => /database went away/.test(error.message)));
    const finished = await until(async () => {
      const row = await store.get(result.runs[0].id);
      return row.state === 'completed' ? row : null;
    }, 'the exit of an untracked-start worker is still observed');
    assert.equal(finished.exitCode, 0);

    // A record-write failure after tracking is reported, not thrown.
    const noRecordDir = makeService(rootDir, {
      store,
      onError: error => errors.push(error),
    });
    await rm(join(rootDir, 'logs', 'dashboard', 'tasks'), { recursive: true, force: true });
    await writeFile(
      join(rootDir, 'logs', 'dashboard', 'tasks'),
      'a file where the folder should be',
    );
    const third = await noRecordDir.service.dispatch({
      action: 'letter',
      jobId: '4',
      requestKey: 'order-3',
    });
    assert.equal(third.runs[0].state, 'running');
  });
});

test('scan: argv with the report path, selection stored, replay, conflict and validation', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    process.env.SYNTH_REPORT = JSON.stringify({ summary: { jobs_found: 3 } });
    const { service, store, spawned } = makeService(rootDir);
    const created = await service.dispatch({
      action: 'scan',
      requestKey: 'scan-a',
      dryRun: true,
      company: 'Acme',
    });
    assert.equal(created.replayed, false);
    const [run] = created.runs;
    assert.deepEqual(
      [run.action, run.jobId, run.groupId, run.source],
      ['scan', null, null, 'browser'],
    );
    const row = store.rows.get(run.id);
    assert.deepEqual(row.selection, { dryRun: true, company: 'Acme' });
    assert.match(row.logRef, /^scan-[0-9-]+-[0-9a-f]{8}\.log$/);
    const [command, args, options] = spawned[0];
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [
      join(rootDir, ...LAUNCHERS.scan),
      '--dry-run',
      '--company=Acme',
      '--report-json=' + join('logs', 'dashboard', row.logRef.replace(/\.log$/, '.scan.json')),
    ]);
    assert.equal(options.cwd, rootDir);
    assert.equal(options.shell, undefined);
    assert.equal(options.env.CAREER_RUN_ID, run.id);
    await until(async () => (await store.get(run.id)).state === 'completed', 'scan completion');
    const record = JSON.parse(
      await readFile(
        join(rootDir, 'logs', 'dashboard', 'tasks', row.logRef.replace(/\.log$/, '.json')),
        'utf8',
      ),
    );
    assert.deepEqual([record.action, record.number], ['scan', 0]);

    // A real scan has no --dry-run and no --company.
    const real = await service.dispatch({ action: 'scan', requestKey: 'scan-b', dryRun: false });
    assert.deepEqual(spawned[1][1].slice(1, -1), []);
    await until(
      async () => (await store.get(real.runs[0].id)).state === 'completed',
      'real scan completion',
    );

    // Same key and selection replays; another selection or action conflicts.
    const replay = await service.dispatch({
      action: 'scan',
      requestKey: 'scan-a',
      dryRun: true,
      company: 'Acme',
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.runs[0].id, run.id);
    assert.equal(spawned.length, 2);
    for (const input of [
      { action: 'scan', requestKey: 'scan-a', dryRun: false, company: 'Acme' },
      { action: 'scan', requestKey: 'scan-a', dryRun: true },
      { action: 'scan', requestKey: 'scan-a', dryRun: true, company: 'Other' },
    ])
      await rejects(service.dispatch(input), 409, 'REQUEST_KEY_CONFLICT');
    await rejects(
      service.dispatch({ action: 'cv', jobId: '4', requestKey: 'scan-a' }),
      409,
      'REQUEST_KEY_CONFLICT',
    );

    for (const [input, field] of [
      [{ action: 'scan', requestKey: 'v', dryRun: 'true' }, 'dryRun'],
      [{ action: 'scan', requestKey: 'v' }, 'dryRun'],
      [{ action: 'scan', requestKey: 'bad key', dryRun: true }, 'requestKey'],
      [{ action: 'scan', requestKey: 'v', dryRun: true, jobId: '5' }, 'jobId'],
      [{ action: 'scan', requestKey: 'v', dryRun: true, company: 5 }, 'company'],
      [{ action: 'scan', requestKey: 'v', dryRun: true, company: '' }, 'company'],
      [{ action: 'scan', requestKey: 'v', dryRun: true, company: ' padded ' }, 'company'],
      [{ action: 'scan', requestKey: 'v', dryRun: true, company: 'x'.repeat(101) }, 'company'],
      [{ action: 'scan', requestKey: 'v', dryRun: true, script: 'x.mjs' }, 'script'],
    ])
      await rejects(service.dispatch(input), 400, 'INVALID_REQUEST', field);
    // A company value is one argv element: shell metacharacters and flags stay literal.
    const odd = await service.dispatch({
      action: 'scan',
      requestKey: 'scan-odd',
      dryRun: true,
      company: '--dry-run; rm -rf /',
    });
    assert.ok(spawned.at(-1)[1].includes('--company=--dry-run; rm -rf /'));
    await until(
      async () => (await store.get(odd.runs[0].id)).state === 'completed',
      'odd completion',
    );
  });
});

test('scan: discovery lock and active scan rows give DISCOVERY_BUSY with the run id', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'sleep';
    delete process.env.SYNTH_REPORT;
    const lock = createDiscoveryLock();
    const { service, store, spawned } = makeService(rootDir, { discoveryLock: lock });
    assert.equal(await service.activeScan(), null);
    const first = await service.dispatch({ action: 'scan', requestKey: 'busy-1', dryRun: false });
    assert.equal(await service.activeScan(), first.runs[0].id);
    for (const dryRun of [false, true])
      await assert.rejects(
        service.dispatch({ action: 'scan', requestKey: 'busy-' + dryRun, dryRun }),
        error => {
          assert.equal(error.statusCode, 409);
          assert.equal(error.publicCode, 'DISCOVERY_BUSY');
          assert.deepEqual(error.current, { activeRunId: first.runs[0].id });
          return true;
        },
      );
    assert.equal(spawned.length, 1);
    assert.equal(lock.holder, null, 'the dispatch lock is released');
    // Job actions are not blocked by a running scan.
    await service.dispatch({ action: 'cv', jobId: '4', requestKey: 'cv-during-scan' });
    // A replay of the running scan is not busy.
    assert.equal(
      (await service.dispatch({ action: 'scan', requestKey: 'busy-1', dryRun: false })).replayed,
      true,
    );
    // An intake holding the lock blocks a scan with no run id.
    const firstPid = store.rows.get(first.runs[0].id).pid;
    await store.finish(first.runs[0].id, 'interrupted', null, 'TEST');
    const hold = lock.tryAcquire('intake');
    await assert.rejects(
      service.dispatch({ action: 'scan', requestKey: 'busy-intake', dryRun: true }),
      error => {
        assert.equal(error.publicCode, 'DISCOVERY_BUSY');
        assert.deepEqual(error.current, { activeRunId: null });
        return true;
      },
    );
    hold();
    const after = await service.dispatch({
      action: 'scan',
      requestKey: 'busy-after',
      dryRun: true,
    });
    assert.equal(after.replayed, false);
    try {
      process.kill(firstPid);
    } catch {
      // Already gone.
    }
    for (const run of await store.list({ limit: 0 }))
      if (run.pid) {
        try {
          process.kill(run.pid);
        } catch {
          // Already gone.
        }
      }
    await until(
      async () => (await store.list({ limit: 0 })).every(r => r.state !== 'running'),
      'workers stopped',
    );
  });
});

test('scan report: projected, redacted and bounded; 404 while absent or for other runs', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const report = {
      schema_version: 1,
      generated_at: '2026-11-10T12:00:00.000Z',
      dry_run: true,
      summary: {
        structured: 2,
        rich_only: 1,
        unclassified: 0,
        ok: 1,
        empty: 0,
        error: 1,
        jobs_found: 7,
        new_offers: 2,
        missing_full_jd: 3,
      },
      companies: [
        {
          company: 'Acme',
          classification: 'structured',
          provider: 'ashby-api',
          status: 'ok',
          jobs_found: 7,
          reason: null,
          careers_url: 'https://private.example/careers',
          scan_query: 'secret query',
        },
        {
          company: 'Broken',
          classification: 'structured',
          provider: null,
          status: 'error',
          jobs_found: 0,
          reason: 'fetch failed at ' + rootDir + ' token=abc123secret',
        },
      ],
      missing: [
        { company: 'Acme', title: 'Engineer', url: 'https://example.invalid/jobs/1' },
        { company: 'Acme', title: 'Bad scheme', url: 'javascript:alert(1)' },
        { company: 'Acme', title: 'Credentials', url: 'https://user:pw@example.invalid/x' },
        { company: 'Acme', title: 'No url' },
      ],
      search_queries: [{ name: 'private query' }],
    };
    process.env.SYNTH_REPORT = JSON.stringify(report);
    const { service, store } = makeService(rootDir);
    const created = await service.dispatch({ action: 'scan', requestKey: 'rep-1', dryRun: true });
    const id = created.runs[0].id;
    const reportFile = join(
      rootDir,
      'logs',
      'dashboard',
      store.rows.get(id).logRef.replace(/\.log$/, '.scan.json'),
    );
    await until(async () => (await store.get(id)).state === 'completed', 'completion');
    const projected = await service.scanReport(id);
    assert.deepEqual(projected.summary, {
      structured: 2,
      richOnly: 1,
      unclassified: 0,
      ok: 1,
      empty: 0,
      error: 1,
      jobsFound: 7,
      newOffers: 2,
      missingFullJd: 3,
    });
    assert.equal(projected.dryRun, true);
    assert.equal(projected.generatedAt, '2026-11-10T12:00:00.000Z');
    assert.deepEqual(projected.missing, [
      { company: 'Acme', title: 'Engineer', url: 'https://example.invalid/jobs/1' },
    ]);
    assert.deepEqual(Object.keys(projected.companies[0]).sort(), [
      'classification',
      'company',
      'jobsFound',
      'provider',
      'reason',
      'status',
    ]);
    const wire = JSON.stringify(projected);
    for (const secret of [
      'private.example',
      'secret query',
      'private query',
      'abc123secret',
      rootDir,
    ])
      assert.equal(wire.includes(secret), false, secret);
    assert.match(projected.companies[1].reason, /<repo>/);
    // Older reports without the new fields read as zero and an empty list.
    await writeFile(
      reportFile,
      JSON.stringify({ schema_version: 1, summary: { jobs_found: 4 }, companies: [] }),
    );
    const legacy = await service.scanReport(id);
    assert.equal(legacy.summary.missingFullJd, 0);
    assert.deepEqual(legacy.missing, []);
    assert.equal(legacy.summary.jobsFound, 4);
    // Absent, corrupt, oversized and wrong-action runs are 404.
    await rm(reportFile);
    await rejects(service.scanReport(id), 404, 'NOT_FOUND');
    await writeFile(reportFile, '{not json');
    await rejects(service.scanReport(id), 404, 'NOT_FOUND');
    await writeFile(reportFile, 'x'.repeat(3 * 1024 * 1024));
    await rejects(service.scanReport(id), 404, 'NOT_FOUND');
    const job = await service.dispatch({ action: 'cv', jobId: '4', requestKey: 'rep-cv' });
    await rejects(service.scanReport(job.runs[0].id), 404, 'NOT_FOUND');
    await rejects(service.scanReport('not-a-uuid'), 400, 'INVALID_REQUEST', 'id');
    await rejects(service.scanReport('00000000-0000-4000-8000-000000000000'), 404, 'NOT_FOUND');
    // A projection never trusts the shape of the file.
    const hostile = projectScanReport({
      summary: { ok: -1, error: 'x' },
      companies: 'nope',
      missing: [null, 5],
    });
    assert.equal(hostile.summary.ok, 0);
    assert.deepEqual([hostile.companies, hostile.missing], [[], []]);
  });
});

test('provider selection: stored on the run and passed as launcher flags, default unchanged', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const selections = {
      evaluate: {
        evaluation: { provider: 'codex', model: 'gpt-5.5' },
        companyResearch: { provider: 'claude', model: 'haiku' },
      },
      cv: { cv: { provider: 'claude', model: 'opus 4' } },
      letter: { coverLetter: { provider: 'codex', model: 'gpt-x' } },
    };
    const { service, store, spawned } = makeService(rootDir, {
      resolveSelection: async action => selections[action] ?? {},
    });
    const evaluated = await service.dispatch({
      action: 'evaluate',
      jobId: '4',
      requestKey: 'sel-e',
    });
    assert.deepEqual(store.rows.get(evaluated.runs[0].id).selection, selections.evaluate);
    assert.deepEqual(spawned[0][1].slice(1), [
      '--job=4',
      '--provider=codex',
      '--model=gpt-5.5',
      '--research-provider=claude',
      '--research-model=haiku',
    ]);
    const pair = await service.dispatch({ action: 'both', jobId: '4', requestKey: 'sel-b' });
    const byAction = Object.fromEntries(
      pair.runs.map(run => [run.action, store.rows.get(run.id).selection]),
    );
    assert.deepEqual(byAction, { cv: selections.cv, letter: selections.letter });
    const pairArgs = spawned.slice(1, 3).map(call => call[1].slice(1));
    assert.ok(
      pairArgs.some(args => args.includes('--model=opus 4') && args.includes('--provider=claude')),
    );
    assert.ok(
      pairArgs.some(args => args.includes('--model=gpt-x') && args.includes('--provider=codex')),
    );
    // A replay never resolves or spawns again.
    const calls = spawned.length;
    await service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'sel-e' });
    assert.equal(spawned.length, calls);
    // Malformed selections never become flags.
    const sloppy = makeService(rootDir, {
      resolveSelection: async () => ({
        evaluation: { provider: 'gemini', model: 'x' },
        companyResearch: { provider: 'claude', model: '' },
      }),
    });
    await sloppy.service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'sel-bad' });
    assert.deepEqual(sloppy.spawned[0][1].slice(1), ['--job=4']);
    // Without a resolver the launch is exactly as before, and a failing resolver stops the dispatch.
    const plain = makeService(rootDir);
    await plain.service.dispatch({ action: 'cv', jobId: '4', requestKey: 'sel-plain' });
    assert.deepEqual(plain.spawned[0][1].slice(1), ['--job=4']);
    assert.deepEqual([...plain.store.rows.values()][0].selection, {});
    const failing = makeService(rootDir, {
      resolveSelection: async () => {
        const error = new Error('settings unreadable');
        error.statusCode = 503;
        error.publicCode = 'SETTINGS_UNREADABLE';
        throw error;
      },
    });
    await rejects(
      failing.service.dispatch({ action: 'cv', jobId: '4', requestKey: 'sel-fail' }),
      503,
      'SETTINGS_UNREADABLE',
    );
    assert.equal(failing.spawned.length, 0);
    assert.equal(
      failing.store.rows.size,
      0,
      'nothing is recorded when the selection cannot be resolved',
    );
    await until(
      async () =>
        [...store.rows.values()].every(run => run.state !== 'running' && run.state !== 'queued'),
      'workers finished',
    );
  });
});

test('restart recovery: a new service sees a live worker as running and a dead one as interrupted', async () => {
  await withRoot(async rootDir => {
    const store = memoryStore();
    const worker = realSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      await until(() => worker.pid, 'worker pid');
      const run = await seedRunning(store, { pid: worker.pid });
      const restarted = makeService(rootDir, { store }).service;
      assert.deepEqual(await restarted.reconcile(), []);
      assert.equal((await store.get(run.id)).state, 'running');
      assert.equal((await restarted.get(run.id)).run.state, 'running');
      worker.kill();
      await until(() => worker.exitCode !== null || worker.signalCode, 'worker exit');
      await until(async () => (await restarted.reconcile()).length === 1, 'interruption');
      assert.equal((await store.get(run.id)).errorCode, 'PROCESS_GONE');
    } finally {
      worker.kill();
    }
  });
});

test('log tail: bounded, line-aligned, offset cursor, and secrets and paths redacted', async () => {
  await withRoot(async rootDir => {
    const { service, store } = makeService(rootDir);
    const run = await seedRunning(store, { logRef: 'evaluate-1-log.log' });
    const logPath = join(rootDir, 'logs', 'dashboard', 'evaluate-1-log.log');
    await mkdir(join(rootDir, 'logs', 'dashboard'), { recursive: true });
    const lines = [];
    for (let index = 0; index < 4000; index++) lines.push(`line ${index} progress ok`);
    lines.push(
      'OPENAI_API_KEY=sk-live-0123456789abcdef0123456789abcdef',
      'Authorization: Bearer abcdefghijklmnop12345678',
      `reading ${rootDir}\\config\\profile.yml`,
      'db postgres://user:hunter2@127.0.0.1/db',
      'password: "correct horse battery staple"',
    );
    await writeFile(logPath, lines.join('\n') + '\n');
    const tail = await service.log(run.id);
    assert.ok(tail.text.length <= 64 * 1024);
    assert.equal(tail.truncated, true);
    assert.ok(tail.text.startsWith('line '), 'the tail starts on a line boundary');
    assert.ok(tail.nextOffset === tail.size);
    for (const secret of [
      'sk-live-0123456789',
      'abcdefghijklmnop12345678',
      'hunter2',
      'correct horse',
      rootDir,
    ])
      assert.equal(tail.text.includes(secret), false, `${secret} must not appear`);
    assert.match(tail.text, /OPENAI_API_KEY=\[redacted\]/);
    assert.match(tail.text, /<repo>/);

    const first = await service.log(run.id, { offset: 0 });
    assert.equal(first.offset, 0);
    assert.equal(first.truncated, false);
    assert.ok(first.nextOffset > 0 && first.nextOffset < first.size);
    assert.ok(first.text.endsWith('\n'), 'chunks end on a line boundary');
    const second = await service.log(run.id, { offset: first.nextOffset });
    assert.equal(second.offset, first.nextOffset);
    assert.ok(second.text.startsWith('line '));
    const past = await service.log(run.id, { offset: tail.size + 1000 });
    assert.deepEqual([past.text, past.nextOffset], ['', tail.size]);

    await rejects(service.log(run.id, { offset: -1 }), 400, 'INVALID_REQUEST', 'offset');
    await rejects(service.log(run.id, { offset: 1.5 }), 400, 'INVALID_REQUEST', 'offset');
    await rejects(service.log('not-a-uuid'), 400, 'INVALID_REQUEST', 'id');
    await rejects(service.log('00000000-0000-4000-8000-000000000000'), 404, 'NOT_FOUND');
    const missing = await seedRunning(store, { logRef: 'evaluate-1-nolog.log' });
    assert.deepEqual(await service.log(missing.id), {
      text: '',
      offset: 0,
      nextOffset: 0,
      size: 0,
      truncated: false,
    });
  });
});

test('redactLog removes credentials, env assignments, tokens and private paths', () => {
  const cases = [
    ['API_KEY=abc123', 'abc123'],
    ['export DATABASE_URL=postgres://u:p@h/db', 'postgres://u:p@h'],
    ['token: ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdef'],
    ['Authorization: Bearer abc.def.ghi-jkl', 'abc.def.ghi-jkl'],
    ['https://user:secretpass@example.com/x', 'secretpass'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk', 'eyJhbGciOiJIUzI1NiJ9'],
    ['key 0123456789abcdef0123456789abcdef0123', '0123456789abcdef0123456789abcdef'],
    ['C:\\Users\\someone\\secret\\file.txt', 'someone'],
    ['/home/someone/file', 'someone'],
    ['{"pdf": "C:\\\\Users\\\\someone\\\\Documents\\\\x.pdf"}', 'someone'],
    ['client_secret = "very-secret-value"', 'very-secret-value'],
    ['\u001b[31mred\u001b[0m SECRET_TOKEN=zzz', 'zzz'],
    ['{"password":"hunter2-json"}', 'hunter2-json'],
    ['{"token": "abc-token-value", "ok": true}', 'abc-token-value'],
    ['{"api_key": 12345678}', '12345678'],
    ['{"nested":{"client_secret":"s3cr3t-nested"}}', 's3cr3t-nested'],
    ['node tool.mjs --token tok-cli-value --job=5', 'tok-cli-value'],
    ['run --password hunter2-flag', 'hunter2-flag'],
    ['run --api-key=key-cli-value', 'key-cli-value'],
    ['run --password "two words here"', 'two words'],
    ['Set-Cookie: sessionid=abc123def456', 'abc123def456'],
    ['sessionid=plainvalue99', 'plainvalue99'],
    ['login failed, password hunter2-bare', 'hunter2-bare'],
    ['passphrase "my secret phrase"', 'secret phrase'],
  ];
  for (const [input, forbidden] of cases)
    assert.equal(
      redactLog(input, { rootDir: '/nonexistent-root' }).includes(forbidden),
      false,
      input,
    );
  // Ordinary log lines and flags are left alone.
  for (const line of [
    'evaluating job --job=12 --dry-run',
    'wrote {"count": 3, "status": "ok"}',
    'phase: drafting attempt 2',
  ])
    assert.equal(redactLog(line, { rootDir: '/nonexistent-root' }), line);
  assert.equal(
    redactLog('plain progress line: evaluating 3 of 10', { rootDir: '/nonexistent-root' }),
    'plain progress line: evaluating 3 of 10',
  );
  assert.equal(redactLog('\u001b[32mgreen\u001b[0m', { rootDir: '/x-root' }), 'green');
});

test('wire runs never carry the pid or log reference and keep only well-formed selection entries', () => {
  const wire = toWireRun({
    id: 'a',
    requestKey: 'k',
    groupId: null,
    action: 'cv',
    jobId: '1',
    state: 'running',
    phase: 'p',
    attempt: 1,
    pid: 42,
    pidStartedAt: 'x',
    exitCode: null,
    errorCode: null,
    logRef: 'cv-1-secret.log',
    selection: { provider: 'x' },
    createdAt: 'c',
    startedAt: 's',
    updatedAt: 'u',
    finishedAt: null,
  });
  const text = JSON.stringify(wire);
  assert.equal(text.includes('42'), false);
  assert.equal(text.includes('secret.log'), false);
  assert.equal(text.includes('provider'), false);
});

test('ready reports the migration state and database failures are safe public errors', async () => {
  const good = createRunsService({ store: memoryStore(), query: async () => [{ ready: true }] });
  assert.equal(await good.ready(), true);
  const absent = createRunsService({ store: memoryStore(), query: async () => [{ ready: false }] });
  assert.equal(await absent.ready(), false);
  const down = createRunsService({
    store: memoryStore(),
    query: async () => {
      throw new Error('secret-driver-text');
    },
  });
  assert.equal(await down.ready(), false);

  const failing = (error, overrides = {}) =>
    createRunsService({
      store: {
        ...memoryStore(),
        list: async () => {
          throw error;
        },
        get: async () => {
          throw error;
        },
        ...overrides,
      },
      rootDir: tmpdir(),
    });
  await assert.rejects(failing(new Error('secret-driver-text')).list(), DatabaseUnavailableError);
  await assert.rejects(
    failing(Object.assign(new Error('x'), { code: '42P01' })).list(),
    SchemaNotReadyError,
  );
  await rejects(failing(new Error('x')).get('nope'), 400, 'INVALID_REQUEST', 'id');
  await assert.rejects(
    failing(new Error('secret-driver-text')).get('00000000-0000-4000-8000-000000000000'),
    DatabaseUnavailableError,
  );
});

test('list validates its job filter and terminal limit, and start/stop drive a periodic reconcile', async () => {
  await withRoot(async rootDir => {
    let passes = 0;
    const store = memoryStore();
    const counting = { ...store, list: async (...args) => (passes++, store.list(...args)) };
    const { service } = makeService(rootDir, { store: counting, intervalMs: 20 });
    await rejects(service.list({ jobId: 'abc' }), 400, 'INVALID_REQUEST', 'jobId');
    assert.deepEqual(await service.list({ jobId: '5' }), { runs: [] });
    for (const limit of ['0', '51', '1.5', 'x', '', '-1', '1e1', 7.5, null])
      await rejects(service.list({ limit }), 400, 'INVALID_REQUEST', 'limit');
    for (const limit of ['1', '50', 12])
      assert.deepEqual(await service.list({ limit }), { runs: [] });
    passes = 0;
    service.start();
    service.start();
    await until(() => passes >= 3, 'periodic reconcile');
    service.stop();
    const stopped = passes;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(passes - stopped <= 1, 'no reconcile after stop');
  });
});

test('factory rejects non-function adapters', () => {
  assert.throws(() => createRunsService({ store: memoryStore(), spawn: 'no' }), TypeError);
  assert.throws(() => createRunsService({ store: memoryStore(), isAlive: null }), TypeError);
});

function fakeFacts(reasons = {}) {
  const base = { evaluate: null, cv: null, letter: null, both: null, ...reasons };
  const block = Object.fromEntries(
    Object.entries(base).map(([name, reason]) => [name, { enabled: reason === null, reason }]),
  );
  return { actions: block, base: block };
}

async function seedActive(store, action, state = 'running', jobId = '4') {
  const run = await store.insert({
    requestKey: 'seed-' + Math.random(),
    action,
    jobId,
    logRef: `${action}-${jobId}-seed-${Math.random().toString(16).slice(2)}.log`,
  });
  if (state === 'running') await store.start(run.id, 99999, new Date());
  return run;
}

async function stopWorkers(store) {
  for (const run of await store.list({ limit: 0 }))
    if (run.pid && run.pid !== 99999) {
      try {
        process.kill(run.pid);
      } catch {
        // Already gone.
      }
    }
  await until(
    async () =>
      [...store.rows.values()].every(
        run => run.pid === 99999 || !['running', 'queued'].includes(run.state),
      ),
    'workers stopped',
  );
}

test('dispatch prerequisites: a failed rule is 409 PREREQUISITE_FAILED with the fresh actions and nothing starts', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    let facts = fakeFacts({ evaluate: 'Only Pending or Evaluated jobs can be evaluated.' });
    const { service, store, spawned } = makeService(rootDir, { actionsFor: async () => facts });
    await assert.rejects(
      service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'p-1' }),
      error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'PREREQUISITE_FAILED');
        assert.equal(error.message, 'Only Pending or Evaluated jobs can be evaluated.');
        assert.deepEqual(error.current.actions, facts.actions);
        return true;
      },
    );
    assert.equal(spawned.length + store.rows.size, 0, 'nothing is recorded or spawned');
    // The rules are per action: cv may pass while letter and both fail.
    facts = fakeFacts({ letter: 'Evaluate the job first.', both: 'Evaluate the job first.' });
    const cv = await service.dispatch({ action: 'cv', jobId: '4', requestKey: 'p-cv' });
    assert.equal(cv.runs[0].action, 'cv');
    await rejects(
      service.dispatch({ action: 'letter', jobId: '4', requestKey: 'p-letter' }),
      409,
      'PREREQUISITE_FAILED',
    );
    await rejects(
      service.dispatch({ action: 'both', jobId: '4', requestKey: 'p-both' }),
      409,
      'PREREQUISITE_FAILED',
    );
    assert.equal(store.rows.size, 1, 'a rejected both records neither child');
    facts = null;
    await rejects(
      service.dispatch({ action: 'cv', jobId: '4', requestKey: 'p-404' }),
      404,
      'NOT_FOUND',
    );
    // Without the adapter the dispatch is as before (fixture servers).
    const plain = makeService(rootDir);
    await plain.service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'p-plain' });
    await until(
      async () =>
        [...store.rows.values(), ...plain.store.rows.values()].every(
          run => run.state !== 'running',
        ),
      'done',
    );
  });
});

test('dispatch active-run rule: RUN_ACTIVE with the run id for the same job and action only', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const store = memoryStore();
    const { service } = makeService(rootDir, { store, actionsFor: async () => fakeFacts() });
    const running = await seedActive(store, 'cv');
    await assert.rejects(
      service.dispatch({ action: 'cv', jobId: '4', requestKey: 'a-1' }),
      error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'RUN_ACTIVE');
        assert.equal(error.message, 'A cv run is already active.');
        assert.deepEqual(error.current, { activeRunId: running.id });
        return true;
      },
    );
    // both is blocked by an active cv child; a different job or action is not.
    await rejects(
      service.dispatch({ action: 'both', jobId: '4', requestKey: 'a-both' }),
      409,
      'RUN_ACTIVE',
    );
    assert.equal(
      [...store.rows.values()].filter(run => run.requestKey.startsWith('a-both')).length,
      0,
    );
    await service.dispatch({ action: 'cv', jobId: '5', requestKey: 'a-other-job' });
    await service.dispatch({ action: 'letter', jobId: '4', requestKey: 'a-letter' });
    // A queued row counts too, and a finished run does not.
    const queued = await seedActive(store, 'evaluate', 'queued');
    await assert.rejects(
      service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'a-eval' }),
      error => {
        assert.equal(error.publicCode, 'RUN_ACTIVE');
        assert.equal(error.current.activeRunId, queued.id);
        return true;
      },
    );
    await store.finish(running.id, 'completed', 0, null);
    await store.finish(queued.id, 'interrupted', null, 'TEST');
    await service.dispatch({ action: 'cv', jobId: '4', requestKey: 'a-after' });
    await service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'a-eval-after' });
    await until(
      async () =>
        [...store.rows.values()].every(run => run.state !== 'running' || run.pid === 99999),
      'done',
    );
  });
});

test('replay ignores prerequisites, the active rule and any override; a pair checks only its missing child', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'sleep';
    const store = memoryStore();
    let facts = fakeFacts();
    const { service, spawned } = makeService(rootDir, {
      store,
      actionsFor: async () => facts,
      resolveSelection: async action =>
        action === 'cv' ? { cv: { provider: 'claude', model: 'sonnet' } } : {},
    });
    const first = await service.dispatch({ action: 'cv', jobId: '4', requestKey: 'r-1' });
    facts = fakeFacts({ cv: 'Evaluate the job first.' });
    const replay = await service.dispatch({
      action: 'cv',
      jobId: '4',
      requestKey: 'r-1',
      selection: { cv: { provider: 'codex', model: 'gpt-5.5' } },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.runs[0].id, first.runs[0].id);
    assert.deepEqual(
      replay.runs[0].selection,
      { cv: { provider: 'claude', model: 'sonnet' } },
      'the stored selection wins',
    );
    assert.equal(spawned.length, 1);
    // A pair whose cv child already exists (and is running) only starts the letter child.
    facts = fakeFacts();
    const cvChild = await store.insert({
      requestKey: 'pair:cv',
      action: 'cv',
      jobId: '4',
      logRef: 'cv-4-pair.log',
      groupId: null,
    });
    await store.start(cvChild.id, 99999, new Date());
    const pair = await service.dispatch({ action: 'both', jobId: '4', requestKey: 'pair' });
    assert.equal(pair.replayed, false);
    assert.deepEqual(pair.runs.map(run => run.action).sort(), ['cv', 'letter']);
    assert.equal(spawned.length, 2, 'only the letter child was spawned');
    await stopWorkers(store);
  });
});

test('selection override: validated per action, merged over the saved selection, stored, passed as flags', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const saved = {
      evaluate: {
        evaluation: { provider: 'claude', model: 'sonnet' },
        companyResearch: { provider: 'claude', model: 'haiku' },
      },
      cv: { cv: { provider: 'claude', model: 'sonnet' } },
      letter: { coverLetter: { provider: 'codex', model: 'gpt-5.5' } },
    };
    let resolved = 0;
    const { service, store, spawned } = makeService(rootDir, {
      actionsFor: async () => fakeFacts(),
      resolveSelection: async action => (resolved++, saved[action] ?? {}),
    });
    const ok = { action: 'evaluate', jobId: '4', requestKey: 'o-ok' };
    // Validation matrix: nothing starts for a rejected request.
    for (const [override, action] of [
      ['nope', 'evaluate'],
      [[], 'evaluate'],
      [null, 'evaluate'],
      [{ cv: { provider: 'claude', model: 'x' } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: 'x' } }, 'cv'],
      [{ cv: { provider: 'claude', model: 'x' } }, 'letter'],
      [{ coverLetter: { provider: 'claude', model: 'x' } }, 'cv'],
      [{ companyResearch: { provider: 'claude', model: 'x' } }, 'both'],
      [{ evaluation: 'claude' }, 'evaluate'],
      [{ evaluation: [] }, 'evaluate'],
      [{ evaluation: { provider: 'openai', model: 'x' } }, 'evaluate'],
      [{ evaluation: { provider: 'Claude', model: 'x' } }, 'evaluate'],
      [{ evaluation: { provider: 'claude' } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: '' } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: '   ' } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: 'x'.repeat(81) } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: 'bad\u0000id' } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: 5 } }, 'evaluate'],
      [{ evaluation: { provider: 'claude', model: 'x', extra: 1 } }, 'evaluate'],
    ])
      await rejects(
        service.dispatch({ ...ok, action, selection: override, requestKey: 'o-bad' }),
        400,
        'INVALID_REQUEST',
        'selection',
      );
    assert.equal(spawned.length + store.rows.size, 0);

    // Evaluate: the override replaces one entry; the other comes from the saved settings.
    const evaluated = await service.dispatch({
      ...ok,
      selection: { evaluation: { provider: 'codex', model: ' gpt-x ' } },
    });
    const expected = {
      evaluation: { provider: 'codex', model: 'gpt-x' },
      companyResearch: { provider: 'claude', model: 'haiku' },
    };
    assert.deepEqual(store.rows.get(evaluated.runs[0].id).selection, expected);
    assert.deepEqual(evaluated.runs[0].selection, expected, 'the merged selection is returned');
    assert.deepEqual(spawned[0][1].slice(2), [
      '--provider=codex',
      '--model=gpt-x',
      '--research-provider=claude',
      '--research-model=haiku',
    ]);
    await until(
      async () => (await store.get(evaluated.runs[0].id)).state === 'completed',
      'completion',
    );
    const log = await readFile(
      join(rootDir, 'logs', 'dashboard', store.rows.get(evaluated.runs[0].id).logRef),
      'utf8',
    );
    assert.match(
      log,
      /args=--job=4 --provider=codex --model=gpt-x --research-provider=claude --research-model=haiku/,
      'the worker saw exactly the stored selection',
    );

    // cv and letter use their own key; saved values fill everything not overridden.
    const cv = await service.dispatch({
      action: 'cv',
      jobId: '4',
      requestKey: 'o-cv',
      selection: { cv: { provider: 'codex', model: 'gpt-5.5' } },
    });
    assert.deepEqual(cv.runs[0].selection, { cv: { provider: 'codex', model: 'gpt-5.5' } });
    const plainLetter = await service.dispatch({
      action: 'letter',
      jobId: '4',
      requestKey: 'o-letter',
    });
    assert.deepEqual(
      plainLetter.runs[0].selection,
      saved.letter,
      'no override means the saved selection',
    );
    assert.deepEqual(spawned.at(-1)[1].slice(2), ['--provider=codex', '--model=gpt-5.5']);

    await until(
      async () => [...store.rows.values()].every(run => run.state !== 'running'),
      'earlier runs finished',
    );
    // both: two grouped runs, each with its own merged selection; one child's key is ignored by the other.
    const pair = await service.dispatch({
      action: 'both',
      jobId: '4',
      requestKey: 'o-both',
      selection: {
        cv: { provider: 'codex', model: 'gpt-cv' },
        coverLetter: { provider: 'claude', model: 'opus' },
      },
    });
    const byAction = Object.fromEntries(pair.runs.map(run => [run.action, run]));
    assert.equal(byAction.cv.groupId, byAction.letter.groupId);
    assert.ok(byAction.cv.groupId);
    assert.deepEqual(byAction.cv.selection, { cv: { provider: 'codex', model: 'gpt-cv' } });
    assert.deepEqual(byAction.letter.selection, {
      coverLetter: { provider: 'claude', model: 'opus' },
    });
    const pairArgs = spawned.slice(-2).map(call => call[1].slice(2).join(' '));
    assert.ok(pairArgs.includes('--provider=codex --model=gpt-cv'));
    assert.ok(pairArgs.includes('--provider=claude --model=opus'));
    assert.ok(resolved > 0);
    await until(
      async () => [...store.rows.values()].every(run => run.state !== 'running'),
      'workers finished',
    );
  });
});

test('one child of a pair failing never cancels the other', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    let launches = 0;
    const { service, store } = makeService(rootDir, {
      actionsFor: async () => fakeFacts(),
      spawn: (command, args, options) => {
        launches++;
        const mode = launches === 1 ? 'fail' : 'ok';
        return realSpawn(command, args, { ...options, env: { ...options.env, SYNTH_MODE: mode } });
      },
    });
    const pair = await service.dispatch({ action: 'both', jobId: '4', requestKey: 'pair-fail' });
    await until(
      async () =>
        pair.runs.every(run => ['completed', 'failed'].includes(store.rows.get(run.id).state)),
      'both finished',
    );
    const states = pair.runs.map(run => store.rows.get(run.id).state).sort();
    assert.deepEqual(states, ['completed', 'failed']);
  });
});

test('concurrent dispatches for one job and action: exactly one starts', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'sleep';
    const store = memoryStore();
    const { service, spawned } = makeService(rootDir, {
      store,
      actionsFor: async () => fakeFacts(),
    });
    const results = await Promise.allSettled([
      service.dispatch({ action: 'cv', jobId: '4', requestKey: 'c-1' }),
      service.dispatch({ action: 'cv', jobId: '4', requestKey: 'c-2' }),
      service.dispatch({ action: 'cv', jobId: '4', requestKey: 'c-3' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    for (const failed of results.filter(result => result.status === 'rejected'))
      assert.equal(failed.reason.publicCode, 'RUN_ACTIVE');
    assert.equal(spawned.length, 1);
    await stopWorkers(store);
  });
});

test('the wire selection keeps only well-formed entries', () => {
  const wire = toWireRun({
    id: 'a',
    requestKey: 'k',
    groupId: null,
    action: 'evaluate',
    jobId: '1',
    state: 'running',
    phase: 'p',
    attempt: 1,
    pid: 42,
    exitCode: null,
    errorCode: null,
    logRef: 'x.log',
    selection: {
      evaluation: { provider: 'codex', model: 'gpt-x', extra: 'dropped' },
      companyResearch: { provider: 'gemini', model: 'x' },
      cv: { provider: 'claude', model: '' },
      bogus: { provider: 'claude', model: 'x' },
      dryRun: true,
      company: null,
    },
    createdAt: 'c',
    startedAt: 's',
    updatedAt: 'u',
    finishedAt: null,
  });
  assert.deepEqual(wire.selection, {
    evaluation: { provider: 'codex', model: 'gpt-x' },
    dryRun: true,
    company: null,
  });
  assert.deepEqual(
    toWireRun({ ...wire, pid: 1, logRef: 'x.log', pidStartedAt: null, selection: undefined })
      .selection,
    {},
  );
});

function fakeLetter({
  path = '/repo/output/Acme/role--4/cover-letter.md',
  text = 'Saved text\n',
} = {}) {
  const hash = 'c'.repeat(64);
  const letter = {
    log: [],
    current: { path, text, contentHash: hash, editable: true },
    hash,
    exclusive: async callback => {
      letter.log.push('enter');
      try {
        return await callback();
      } finally {
        letter.log.push('exit');
      }
    },
    snapshot: async id => {
      letter.log.push(`snapshot:${id}`);
      return letter.current;
    },
  };
  return letter;
}

test('publish dispatch: exact argv (launcher plus the absolute letter path), job set, no selection', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const letter = fakeLetter({
      path: join(rootDir, 'output', 'Acme', 'role--4', 'cover-letter.md'),
    });
    let resolved = 0;
    const { service, store, spawned } = makeService(rootDir, {
      letterService: letter,
      actionsFor: async () => fakeFacts({ publish: null }),
      resolveSelection: async () => (
        resolved++,
        { coverLetter: { provider: 'claude', model: 'x' } }
      ),
    });
    const created = await service.dispatch({
      action: 'publish',
      jobId: '4',
      requestKey: 'pub-1',
      expectedHash: letter.hash,
    });
    assert.equal(created.replayed, false);
    assert.equal(created.runs.length, 1);
    const [run] = created.runs;
    assert.equal(run.action, 'publish');
    assert.equal(run.jobId, '4');
    assert.equal(run.groupId, null);
    assert.deepEqual(run.selection, {});
    assert.equal(resolved, 0, 'no provider selection is resolved for a publish');
    assert.equal(spawned.length, 1);
    const [command, args, options] = spawned[0];
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [
      join(rootDir, 'src', 'cvgen', 'publish-cover-letter.mjs'),
      letter.current.path,
    ]);
    assert.equal(options.detached, true);
    assert.equal(options.cwd, rootDir);
    assert.match(
      store.rows.get(run.id).logRef,
      /^publish-4-\d{8}-\d{6}-[0-9a-f]{8}\.log$/,
      'the stamp is kept',
    );
    assert.deepEqual(letter.log, ['enter', 'snapshot:4', 'exit'], 'the check ran inside the lock');
    await until(async () => store.rows.get(run.id).state === 'completed', 'completed');
    const log = await service.log(run.id);
    assert.match(log.text, /args=.*cover-letter\.md/);
    assert.doesNotMatch(log.text, /--job|--provider/);
  });
});

test('publish dispatch: the hash must equal the saved file, else LETTER_CONFLICT with the current text', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const letter = fakeLetter();
    const { service, store, spawned } = makeService(rootDir, {
      letterService: letter,
      actionsFor: async () => fakeFacts({ publish: null }),
    });
    await assert.rejects(
      service.dispatch({
        action: 'publish',
        jobId: '4',
        requestKey: 'pub-stale',
        expectedHash: 'd'.repeat(64),
      }),
      error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'LETTER_CONFLICT');
        assert.deepEqual(error.current, { text: 'Saved text\n', contentHash: letter.hash });
        return true;
      },
    );
    assert.equal(spawned.length + store.rows.size, 0, 'nothing is recorded or spawned');
    // The file vanished or became non-editable between the detail read and the dispatch.
    for (const current of [null, { path: '/x', text: '', contentHash: '', editable: false }]) {
      letter.current = current;
      await assert.rejects(
        service.dispatch({
          action: 'publish',
          jobId: '4',
          requestKey: 'pub-gone',
          expectedHash: letter.hash,
        }),
        error => {
          assert.equal(error.publicCode, 'PREREQUISITE_FAILED');
          assert.equal(error.message, 'No cover letter to publish.');
          return true;
        },
      );
    }
    assert.equal(spawned.length + store.rows.size, 0);
  });
});

test('publish dispatch: prerequisites and the active-run rule (publish or letter blocks, others do not)', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const letter = fakeLetter();
    let facts = fakeFacts({ publish: 'No cover letter to publish.' });
    const store = memoryStore();
    const { service, spawned } = makeService(rootDir, {
      store,
      letterService: letter,
      actionsFor: async () => facts,
    });
    const request = key => ({
      action: 'publish',
      jobId: '4',
      requestKey: key,
      expectedHash: letter.hash,
    });
    await assert.rejects(service.dispatch(request('p-1')), error => {
      assert.equal(error.publicCode, 'PREREQUISITE_FAILED');
      assert.equal(error.message, 'No cover letter to publish.');
      assert.deepEqual(error.current.actions, facts.actions);
      return true;
    });
    facts = fakeFacts();
    for (const action of ['publish', 'letter']) {
      const active = await seedActive(store, action);
      await assert.rejects(service.dispatch(request(`p-${action}`)), error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'RUN_ACTIVE');
        assert.equal(error.message, `A ${action} run is already active.`);
        assert.deepEqual(error.current, { activeRunId: active.id });
        return true;
      });
      await store.finish(active.id, 'completed', 0, null);
    }
    // Active runs of other actions, or for another job, do not block it.
    await seedActive(store, 'cv');
    await seedActive(store, 'evaluate');
    await seedActive(store, 'publish', 'running', '5');
    const ok = await service.dispatch(request('p-ok'));
    assert.equal(ok.runs[0].action, 'publish');
    assert.equal(spawned.length, 1);
    await until(async () => store.rows.get(ok.runs[0].id).state === 'completed', 'completed');
    await rejects(service.dispatch({ ...request('p-404'), jobId: '404' }), 404, 'NOT_FOUND');
  });
});

test('publish dispatch: replay returns the stored run; a key used for another run conflicts', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const letter = fakeLetter();
    const { service, spawned } = makeService(rootDir, {
      letterService: letter,
      actionsFor: async () => fakeFacts(),
    });
    const request = {
      action: 'publish',
      jobId: '4',
      requestKey: 'pub-r',
      expectedHash: letter.hash,
    };
    const first = await service.dispatch(request);
    // A replay skips the checks, so a changed hash or letter does not matter.
    letter.current = { ...letter.current, contentHash: 'e'.repeat(64) };
    const again = await service.dispatch(request);
    assert.equal(again.replayed, true);
    assert.equal(again.runs[0].id, first.runs[0].id);
    assert.equal(spawned.length, 1);
    await rejects(service.dispatch({ ...request, jobId: '5' }), 409, 'REQUEST_KEY_CONFLICT');
    await rejects(
      service.dispatch({ action: 'letter', jobId: '4', requestKey: 'pub-r' }),
      409,
      'REQUEST_KEY_CONFLICT',
    );
  });
});

test('publish dispatch: request validation and unavailability', async () => {
  await withRoot(async rootDir => {
    const letter = fakeLetter();
    const { service, spawned } = makeService(rootDir, { letterService: letter });
    const good = { action: 'publish', jobId: '4', requestKey: 'pub-v', expectedHash: letter.hash };
    for (const [patch, field] of [
      [{ expectedHash: undefined }, 'expectedHash'],
      [{ expectedHash: 'abc' }, 'expectedHash'],
      [{ expectedHash: 'C'.repeat(64) }, 'expectedHash'],
      [{ expectedHash: 5 }, 'expectedHash'],
      [{ jobId: '0' }, 'jobId'],
      [{ requestKey: 'a b' }, 'requestKey'],
      [{ selection: {} }, 'selection'],
      [{ path: '../x' }, 'path'],
      [{ script: 'evil.mjs' }, 'script'],
    ])
      await rejects(service.dispatch({ ...good, ...patch }), 400, 'INVALID_REQUEST', field);
    // The hash belongs to publish only.
    await rejects(
      service.dispatch({
        action: 'letter',
        jobId: '4',
        requestKey: 'k',
        expectedHash: good.expectedHash,
      }),
      400,
      'INVALID_REQUEST',
      'expectedHash',
    );
    assert.equal(spawned.length, 0);
    const bare = makeService(rootDir);
    await rejects(bare.service.dispatch(good), 503, 'TASKS_UNAVAILABLE');
  });
});

test('publish dispatch: a launcher that exits non-zero ends the run failed', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'fail';
    const letter = fakeLetter();
    const { service, store } = makeService(rootDir, {
      letterService: letter,
      actionsFor: async () => fakeFacts(),
    });
    const created = await service.dispatch({
      action: 'publish',
      jobId: '4',
      requestKey: 'pub-f',
      expectedHash: letter.hash,
    });
    const run = await until(async () => {
      const row = store.rows.get(created.runs[0].id);
      return row.state === 'failed' ? row : null;
    }, 'failed');
    assert.equal(run.errorCode, 'EXIT_NONZERO');
    assert.equal(run.exitCode, 3);
    process.env.SYNTH_MODE = 'ok';
  });
});

test('list limit bounds the terminal rows while active rows are always listed', async () => {
  await withRoot(async rootDir => {
    const store = memoryStore();
    const { service } = makeService(rootDir, { store });
    for (let index = 0; index < 5; index += 1) {
      const run = await seedActive(store, 'cv', 'queued', '4');
      await store.finish(run.id, 'completed', 0, null);
    }
    await seedActive(store, 'letter', 'running', '4');
    assert.equal((await service.list({ jobId: '4' })).runs.length, 6);
    assert.equal((await service.list({ jobId: '4', limit: '2' })).runs.length, 3);
    assert.equal((await service.list({ jobId: '4', limit: '1' })).runs[0].state, 'running');
  });
});

test('both: a failing selection resolver records and launches neither child', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    let calls = 0;
    const { service, store, spawned } = makeService(rootDir, {
      resolveSelection: async task => {
        calls += 1;
        if (task === 'letter') throw new Error('settings unreadable');
        return {};
      },
    });
    await assert.rejects(service.dispatch({ action: 'both', jobId: '4', requestKey: 'both-fail' }));
    assert.equal(calls, 2, 'both selections were resolved up front');
    assert.equal(spawned.length + store.rows.size, 0, 'neither child was recorded or launched');
  });
});

test('actionsFor must be a function when given', () => {
  assert.throws(() => createRunsService({ store: memoryStore(), actionsFor: 'x' }), TypeError);
  assert.doesNotThrow(() => createRunsService({ store: memoryStore(), actionsFor: null }));
});

test('legacy TUI records are listed after browser rows, honour limit, and serve get and log', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const tasks = join(rootDir, 'logs', 'dashboard', 'tasks');
    await mkdir(tasks, { recursive: true });
    const stamp = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
    for (let index = 0; index < 4; index += 1)
      await writeFile(
        join(tasks, `evaluate-${index + 1}-20260101-000000-${1000 + index}.json`),
        JSON.stringify({
          action: 'evaluate',
          number: index + 1,
          pid: 1,
          log: `C:\\somewhere\\private\\evaluate-${index + 1}.log`,
          state: 'completed',
          phase: 'done',
          attempt: 1,
          started_at: stamp(100 + index),
          finished_at: stamp(90 + index),
          exit_code: 0,
        }),
      );
    await writeFile(join(rootDir, 'logs', 'dashboard', 'evaluate-1.log'), 'legacy log line\n');
    const { service, store } = makeService(rootDir);
    const done = await seedActive(store, 'cv', 'queued', '4');
    await store.finish(done.id, 'completed', 0, null);
    await seedActive(store, 'letter', 'running', '4');
    const all = (await service.list({ limit: '50' })).runs;
    assert.deepEqual(
      all.map(run => run.source),
      ['browser', 'browser', 'legacy', 'legacy', 'legacy', 'legacy'],
      'legacy rows follow the browser rows',
    );
    // The terminal limit covers both sources: one browser row leaves room for one legacy row.
    const limited = (await service.list({ limit: '2' })).runs;
    assert.deepEqual(
      limited.map(run => run.source),
      ['browser', 'browser', 'legacy'],
    );
    assert.equal((await service.list({ jobId: '2', limit: '50' })).runs.at(-1).jobId, '2');
    const legacy = all.find(run => run.source === 'legacy' && run.jobId === '1');
    assert.equal((await service.get(legacy.id)).run.requestKey, legacy.requestKey);
    const log = await service.log(legacy.id);
    assert.equal(log.text, 'legacy log line\n');
    assert.equal(JSON.stringify(all).includes('private'), false, 'the record log path never leaks');
    // A legacy run whose log file is gone reads as empty; an unknown id is a plain 404.
    const noLog = all.find(run => run.source === 'legacy' && run.jobId === '3');
    assert.equal((await service.log(noLog.id)).text, '', 'a missing log file reads as empty');
    await rejects(service.get('11111111-2222-4333-8444-555555555555'), 404, 'NOT_FOUND');
    // The legacy source can be switched off, and a failing one never hides browser rows.
    const off = makeService(rootDir, { legacy: null }).service;
    assert.equal(
      (await off.list({ limit: '50' })).runs.some(run => run.source === 'legacy'),
      false,
    );
    const errors = [];
    const broken = makeService(rootDir, {
      store,
      legacy: {
        list: async () => {
          throw new Error('boom');
        },
        find: async () => null,
      },
      onError: error => errors.push(error),
    }).service;
    assert.equal((await broken.list()).runs.length, 2);
    assert.equal(errors.length, 1);
  });
});

test('a browser run writes its own record with the run id and is not doubled as legacy', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const { service, store } = makeService(rootDir);
    const created = await service.dispatch({ action: 'evaluate', jobId: '9', requestKey: 'k-dup' });
    const [run] = created.runs;
    await until(async () => store.rows.get(run.id).state === 'completed', 'completed');
    const listed = (await service.list({ limit: '50' })).runs;
    assert.deepEqual(
      listed.map(row => [row.id, row.source]),
      [[run.id, 'browser']],
    );
    const names = await readdir(join(rootDir, 'logs', 'dashboard', 'tasks'));
    assert.equal(names.length, 1);
    const record = JSON.parse(
      await readFile(join(rootDir, 'logs', 'dashboard', 'tasks', names[0]), 'utf8'),
    );
    assert.equal(record.run_id, run.id);
  });
});

test('F20: a missing provider CLI is 409 PROVIDER_UNAVAILABLE before any run row; present dispatches; results cache 60 s', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    let clock = Date.parse('2026-11-10T12:00:00Z');
    const probes = [];
    let codexInstalled = false;
    const { service, store, spawned } = makeService(rootDir, {
      now: () => new Date(clock),
      resolveSelection: async () => ({
        evaluation: { provider: 'codex', model: 'gpt-6.1-sol' },
        companyResearch: { provider: 'claude', model: 'haiku' },
      }),
      checkProvider: async provider => {
        probes.push(provider);
        return {
          available: provider === 'claude' || codexInstalled,
          command: provider,
        };
      },
    });
    const missing = () =>
      service.dispatch({ action: 'evaluate', jobId: '4', requestKey: 'f20-' + clock });
    await assert.rejects(missing(), error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, 'PROVIDER_UNAVAILABLE');
      assert.equal(error.message, 'The Codex command line tool was not found on this machine.');
      assert.deepEqual(error.current, { provider: 'codex', command: 'codex' });
      return true;
    });
    assert.equal(spawned.length + store.rows.size, 0, 'nothing is recorded or spawned');
    const probesAfterFirst = probes.length;
    await assert.rejects(missing(), { publicCode: 'PROVIDER_UNAVAILABLE' });
    assert.equal(probes.length, probesAfterFirst, 'the result is cached within 60 s');
    codexInstalled = true;
    clock += 61_000;
    const dispatched = await service.dispatch({
      action: 'evaluate',
      jobId: '4',
      requestKey: 'f20-ok',
    });
    assert.equal(dispatched.runs.length, 1);
    assert.ok(probes.length > probesAfterFirst, 'expired entries are probed again');
  });
});

test('F20: the default provider check starts <command> --version and treats only a failed start as missing', async () => {
  const run = async ({ config, behave, timeoutMs = 50 }) => {
    const calls = [];
    const check = createProviderCheck({
      readConfig: async () => config,
      timeoutMs,
      spawn: (command, args, options) => {
        calls.push([command, args, options.shell]);
        const child = new EventEmitter();
        child.kill = () => {};
        behave(child);
        return child;
      },
    });
    return { calls, result: await check('codex') };
  };
  const missing = await run({
    config: { codex_command: 'C:/private/tools/codex.exe' },
    behave: child => setImmediate(() => child.emit('error', new Error('spawn ENOENT'))),
  });
  assert.deepEqual(missing.result, { available: false, command: 'codex.exe' });
  assert.deepEqual(missing.calls[0].slice(1), [['--version'], false]);
  const present = await run({
    config: {},
    behave: child => setImmediate(() => child.emit('exit', 1)),
  });
  assert.deepEqual(present.result, { available: true, command: 'codex' });
  const slow = await run({ config: {}, behave: () => {} });
  assert.equal(slow.result.available, true, 'a probe that times out does not block a run');
  const thrown = createProviderCheck({
    readConfig: async () => ({}),
    spawn: () => {
      throw new Error('boom');
    },
  });
  assert.equal((await thrown('claude')).available, false);
});

// ---- evaluate batches ----------------------------------------------------------------------

// Fake workers: each spawn returns a controllable child; nothing real runs.
function fakeSpawner() {
  const children = [];
  let pid = 40_000;
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.pid = pid++;
    child.unref = () => {};
    child.args = args;
    children.push(child);
    return child;
  };
  return { spawn, children };
}

function batchService(rootDir, overrides = {}) {
  const fake = fakeSpawner();
  const made = makeService(rootDir, {
    spawn: fake.spawn,
    isAlive: () => true,
    pendingJobIds: async count => ['1', '2', '3', '4', '5', '6'].slice(0, count),
    ...overrides,
  });
  return { ...made, ...fake };
}

const stateOf = async (store, id) => (await store.get(id)).state;
const exitChild = async (child, code = 0) => {
  child.emit('exit', code);
  await new Promise(resolve => setTimeout(resolve, 20));
};

test('batch by jobIds: one group, saved selection, concurrency bound, a fourth run starts after one finishes', async () => {
  await withRoot(async rootDir => {
    const { service, store, children } = batchService(rootDir, {
      resolveSelection: async () => ({ evaluation: { provider: 'claude', model: 'm-1' } }),
    });
    const created = await service.dispatchEvaluateBatch({
      requestKey: 'b-1',
      jobIds: ['1', '2', '3', '4', '5'],
    });
    assert.equal(created.replayed, false);
    assert.deepEqual(created.skipped, []);
    assert.equal(created.runs.length, 5);
    assert.ok(created.groupId);
    assert.ok(
      created.runs.every(run => run.groupId === created.groupId && run.action === 'evaluate'),
    );
    assert.deepEqual(
      created.runs.map(run => run.state),
      ['running', 'running', 'queued', 'queued', 'queued'],
    );
    assert.equal(children.length, 2);
    assert.ok(children[0].args.includes('--provider=claude'));
    assert.ok(children[0].args.includes('--model=m-1'));
    assert.deepEqual(created.runs[3].selection, {
      evaluation: { provider: 'claude', model: 'm-1' },
    });

    await exitChild(children[1]);
    assert.equal(children.length, 3, 'the third starts only after one finished');
    assert.equal(await stateOf(store, created.runs[2].id), 'running');
    assert.equal(await stateOf(store, created.runs[3].id), 'queued');
    await exitChild(children[0]);
    assert.equal(children.length, 4);
    await exitChild(children[2]);
    assert.equal(children.length, 5);
    for (const child of [children[3], children[4]]) await exitChild(child);
    assert.deepEqual(await Promise.all(created.runs.map(run => stateOf(store, run.id))), [
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
  });
});

test('batch by next takes N Pending jobs in order; skipped jobs carry a reason and the rest start', async () => {
  await withRoot(async rootDir => {
    const asked = [];
    const { service, children } = batchService(rootDir, {
      pendingJobIds: async count => (asked.push(count), ['7', '404', '9']),
      actionsFor: async id => ({
        base: { evaluate: { reason: id === '9' ? 'No JD.' : null } },
        actions: {},
      }),
    });
    const created = await service.dispatchEvaluateBatch({ requestKey: 'b-next', next: 3 });
    assert.deepEqual(asked, [3]);
    assert.deepEqual(
      created.runs.map(run => run.jobId),
      ['7'],
    );
    assert.deepEqual(created.skipped, [
      { jobId: '404', reason: 'Job not found.' },
      { jobId: '9', reason: 'No JD.' },
    ]);
    assert.equal(children.length, 1);
  });
});

test('batch skips a job with an active run, and starts nothing when nothing is eligible', async () => {
  await withRoot(async rootDir => {
    const { service, children, store } = batchService(rootDir, {
      actionsFor: async () => ({ base: {}, actions: {} }),
    });
    await service.dispatch({ action: 'evaluate', jobId: '2', requestKey: 's-2' });
    const created = await service.dispatchEvaluateBatch({
      requestKey: 'b-act',
      jobIds: ['1', '2'],
    });
    assert.deepEqual(
      created.runs.map(run => run.jobId),
      ['1'],
    );
    assert.equal(created.skipped[0].jobId, '2');
    assert.match(created.skipped[0].reason, /already active/);
    const before = store.rows.size;
    await assert.rejects(
      service.dispatchEvaluateBatch({ requestKey: 'b-none', jobIds: ['2', '404'] }),
      error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'NO_ELIGIBLE_JOBS');
        assert.equal(error.current.skipped.length, 2);
        return true;
      },
    );
    assert.equal(store.rows.size, before);
    assert.equal(children.length, 2);
  });
});

test('batch validation: exactly one of jobIds or next, bounds, uniqueness, extra fields', async () => {
  await withRoot(async rootDir => {
    const { service } = batchService(rootDir);
    const bad = [
      {},
      { requestKey: 'k' },
      { requestKey: 'k', jobIds: ['1'], next: 1 },
      { requestKey: 'k', jobIds: [] },
      { requestKey: 'k', jobIds: ['1', '1'] },
      { requestKey: 'k', jobIds: ['01'] },
      { requestKey: 'k', jobIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
      { requestKey: 'k', next: 0 },
      { requestKey: 'k', next: 101 },
      { requestKey: 'k', next: 1.5 },
      { requestKey: 'bad key', next: 1 },
      { requestKey: 'k', next: 1, extra: true },
    ];
    for (const body of bad)
      await rejects(service.dispatchEvaluateBatch(body), 400, 'INVALID_REQUEST');
  });
});

test('batch requestKey is idempotent: the replay returns the group and starts nothing', async () => {
  await withRoot(async rootDir => {
    const { service, children, store } = batchService(rootDir);
    const first = await service.dispatchEvaluateBatch({ requestKey: 'b-idem', next: 2 });
    const again = await service.dispatchEvaluateBatch({ requestKey: 'b-idem', next: 2 });
    assert.equal(again.replayed, true);
    assert.equal(again.groupId, first.groupId);
    assert.deepEqual(
      again.runs.map(run => run.id),
      first.runs.map(run => run.id),
    );
    assert.equal(children.length, 2);
    assert.equal(store.rows.size, 2);
    // A key already used by a non-batch run is a conflict.
    await service.dispatch({ action: 'cv', jobId: '3', requestKey: 'solo' });
    await rejects(
      service.dispatchEvaluateBatch({ requestKey: 'solo', next: 1 }),
      409,
      'REQUEST_KEY_CONFLICT',
    );
  });
});

test('cancel-queued interrupts waiting runs of the group, leaves running ones, and never starts them', async () => {
  await withRoot(async rootDir => {
    const { service, store, children } = batchService(rootDir, { batchConcurrency: 1 });
    const created = await service.dispatchEvaluateBatch({ requestKey: 'b-cancel', next: 3 });
    assert.deepEqual(
      created.runs.map(run => run.state),
      ['running', 'queued', 'queued'],
    );
    const result = await service.cancelQueued(created.groupId);
    assert.deepEqual(result, { groupId: created.groupId, cancelled: 2 });
    assert.equal(await stateOf(store, created.runs[0].id), 'running');
    for (const run of created.runs.slice(1)) {
      const row = await store.get(run.id);
      assert.deepEqual([row.state, row.errorCode], ['interrupted', 'CANCELLED']);
    }
    await exitChild(children[0]);
    assert.equal(children.length, 1, 'cancelled runs never start');
    assert.equal((await service.cancelQueued(created.groupId)).cancelled, 0);
    await rejects(service.cancelQueued('not-a-uuid'), 400, 'INVALID_REQUEST');
    await rejects(service.cancelQueued('11111111-2222-4333-8444-555555555555'), 404, 'NOT_FOUND');
  });
});

test('reconcile: a queued run waiting its turn is kept, an orphaned queued run is settled', async () => {
  await withRoot(async rootDir => {
    const { service, store, children } = batchService(rootDir, { batchConcurrency: 1 });
    const created = await service.dispatchEvaluateBatch({ requestKey: 'b-rec', next: 2 });
    const waiting = created.runs[1];
    for (const run of created.runs)
      store.rows.get(run.id).createdAt = new Date(Date.now() - 10 * 60_000).toISOString();
    // An orphan: same group, queued, unknown to the in-memory table (as after a restart).
    const orphan = await store.insert({
      requestKey: 'b-rec:orphan',
      groupId: created.groupId,
      action: 'evaluate',
      jobId: '9',
      logRef: 'evaluate-9-orphan.log',
    });
    store.rows.get(orphan.id).createdAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const changed = await service.reconcile();
    assert.deepEqual(
      changed.map(run => [run.id, run.errorCode]),
      [[orphan.id, 'QUEUE_STALE']],
    );
    assert.equal(await stateOf(store, waiting.id), 'queued');
    await exitChild(children[0]);
    assert.equal(await stateOf(store, waiting.id), 'running');
    await exitChild(children[1]);
  });
});

test('a batch run whose spawn fails frees its slot for the next one', async () => {
  await withRoot(async rootDir => {
    let calls = 0;
    const fake = fakeSpawner();
    const { service, store } = makeService(rootDir, {
      batchConcurrency: 1,
      spawn: (...args) => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return fake.spawn(...args);
      },
    });
    const created = await service.dispatchEvaluateBatch({
      requestKey: 'b-fail',
      jobIds: ['1', '2'],
    });
    await until(async () => fake.children.length === 1, 'second run starts');
    assert.equal(await stateOf(store, created.runs[0].id), 'failed');
    await exitChild(fake.children[0]);
  });
});

test('batch never runs two jobs of one company at once, even across batches', async () => {
  await withRoot(async rootDir => {
    const company = { 1: 'Acme Corp', 2: 'ACME  corp.', 3: 'Other Inc' };
    const { service, store, children } = batchService(rootDir, {
      batchConcurrency: 2,
      findJob: async id => ({ id, status: 'Pending', company: company[id] }),
    });
    const created = await service.dispatchEvaluateBatch({
      requestKey: 'b-co',
      jobIds: ['1', '2', '3'],
    });
    // Job 2 shares Acme's slug with job 1, so it waits and the other company takes the slot.
    assert.deepEqual(
      created.runs.map(run => [run.jobId, run.state]),
      [
        ['1', 'running'],
        ['2', 'queued'],
        ['3', 'running'],
      ],
    );
    assert.equal(children.length, 2);
    const byJob = id => children.find(child => child.args.includes(`--job=${id}`));
    await exitChild(byJob('3'));
    assert.equal(children.length, 2, 'a free slot does not start a same-company run');
    await exitChild(byJob('1'));
    assert.equal(children.length, 3, 'the same-company run starts after the first exits');
    assert.equal(await stateOf(store, created.runs[1].id), 'running');
    await exitChild(byJob('2'));
  });
});

test('a location review the worker reported (failed, LOCATION_REVIEW) is kept when the server sees the exit', async () => {
  await withRoot(async rootDir => {
    const { service, store, children } = batchService(rootDir);
    const { runs } = await service.dispatchEvaluateBatch({ requestKey: 'loc-1', jobIds: ['1'] });
    // The worker's own beforeExit report lands first; the exit observer must not overwrite it.
    await store.finish(runs[0].id, 'failed', 2, 'LOCATION_REVIEW');
    await exitChild(children[0], 2);
    const row = await store.get(runs[0].id);
    assert.deepEqual([row.state, row.exitCode, row.errorCode], ['failed', 2, 'LOCATION_REVIEW']);
    // Without a worker report the exit observer records the generic code.
    const other = await service.dispatchEvaluateBatch({ requestKey: 'loc-2', jobIds: ['2'] });
    await exitChild(children[1], 2);
    assert.equal((await store.get(other.runs[0].id)).errorCode, 'EXIT_NONZERO');
  });
});

test('a running single evaluate holds a waiting batch run for the same company, and is never held itself', async () => {
  await withRoot(async rootDir => {
    const company = { 1: 'Acme', 2: 'Other', 3: 'acme' };
    const { service, store, children } = batchService(rootDir, {
      findJob: async id => ({ id, status: 'Pending', company: company[id] }),
    });
    const single = await service.dispatch({ action: 'evaluate', jobId: '1', requestKey: 's-co' });
    assert.equal(single.runs[0].state, 'running');
    const created = await service.dispatchEvaluateBatch({
      requestKey: 'b-single',
      jobIds: ['3', '2'],
    });
    // Job 3 shares Acme with the running single run, so it waits; the other company starts.
    assert.deepEqual(
      created.runs.map(run => [run.jobId, run.state]),
      [
        ['3', 'queued'],
        ['2', 'running'],
      ],
    );
    const byJob = id => children.find(child => child.args.includes(`--job=${id}`));
    await exitChild(byJob('1'));
    assert.equal(
      await stateOf(store, created.runs[0].id),
      'running',
      'starts once the single exits',
    );
    await exitChild(byJob('3'));
    await exitChild(byJob('2'));
  });
});

test('liveness: argv for one job and for all, replay, conflicts and overlap rules', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const { service, store, spawned } = makeService(rootDir);
    const one = await service.dispatch({ action: 'liveness', requestKey: 'lv-1', jobId: '7' });
    assert.equal(one.replayed, false);
    assert.deepEqual(
      [one.runs[0].action, one.runs[0].jobId, one.runs[0].source],
      ['liveness', '7', 'browser'],
    );
    assert.deepEqual(spawned[0][1], [join(rootDir, ...LAUNCHERS.liveness), '--job=7']);
    assert.match(store.rows.get(one.runs[0].id).logRef, /^liveness-7-[0-9-]+-[0-9a-f]{8}\.log$/);
    await until(
      async () => (await store.get(one.runs[0].id)).state === 'completed',
      'job check completion',
    );
    const replay = await service.dispatch({ action: 'liveness', requestKey: 'lv-1', jobId: '7' });
    assert.equal(replay.replayed, true);
    await rejects(
      service.dispatch({ action: 'liveness', requestKey: 'lv-1', jobId: '8' }),
      409,
      'REQUEST_KEY_CONFLICT',
    );
    await rejects(
      service.dispatch({ action: 'liveness', requestKey: 'lv-x', jobId: '404' }),
      404,
      'NOT_FOUND',
    );

    const all = await service.dispatch({ action: 'liveness', requestKey: 'lv-all' });
    assert.equal(all.runs[0].jobId, null);
    assert.deepEqual(spawned[1][1], [join(rootDir, ...LAUNCHERS.liveness), '--all']);
    await until(
      async () => (await store.get(all.runs[0].id)).state === 'completed',
      'whole-board completion',
    );

    // A whole-board run never overlaps another one or a scan; a job run never overlaps a run of
    // that job.
    const active = await seedActive(store, 'liveness', 'running', null);
    await rejects(service.dispatch({ action: 'liveness', requestKey: 'lv-2' }), 409, 'RUN_ACTIVE');
    store.rows.get(active.id).state = 'completed';
    const scan = await seedActive(store, 'scan', 'running', null);
    await rejects(
      service.dispatch({ action: 'liveness', requestKey: 'lv-3' }),
      409,
      'DISCOVERY_BUSY',
    );
    store.rows.get(scan.id).state = 'completed';
    await seedActive(store, 'evaluate', 'running', '9');
    await rejects(
      service.dispatch({ action: 'liveness', requestKey: 'lv-4', jobId: '9' }),
      409,
      'RUN_ACTIVE',
    );

    for (const [body, field] of [
      [{ action: 'liveness', requestKey: 'bad key' }, 'requestKey'],
      [{ action: 'liveness', requestKey: 'v', jobId: '0' }, 'jobId'],
      [{ action: 'liveness', requestKey: 'v', jobId: 7 }, 'jobId'],
      [{ action: 'liveness', requestKey: 'v', dryRun: true }, 'dryRun'],
    ])
      await rejects(service.dispatch(body), 400, 'INVALID_REQUEST', field);
  });
});

test('a scan is refused while a whole-board posting check is active, but not for a single-job check', async () => {
  await withRoot(async rootDir => {
    process.env.SYNTH_MODE = 'ok';
    const { service, store } = makeService(rootDir);
    const single = await seedActive(store, 'liveness', 'running', '7');
    const scanOk = await service.dispatch({ action: 'scan', requestKey: 'scan-ok', dryRun: true });
    assert.equal(scanOk.replayed, false);
    await until(
      async () => (await store.get(scanOk.runs[0].id)).state === 'completed',
      'scan completion',
    );
    store.rows.get(single.id).state = 'completed';
    const whole = await seedActive(store, 'liveness', 'running', null);
    await assert.rejects(
      service.dispatch({ action: 'scan', requestKey: 'scan-busy', dryRun: true }),
      error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'DISCOVERY_BUSY');
        assert.equal(error.current.activeRunId, whole.id);
        return true;
      },
    );
    store.rows.get(whole.id).state = 'completed';
  });
});
