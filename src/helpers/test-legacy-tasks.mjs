import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { auditTasks, classifyTask, formatReport, main } from './legacy-tasks.mjs';

const now = Date.parse('2026-11-10T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const running = (over = {}) => ({
  action: 'both',
  number: 7,
  pid: 4321,
  state: 'running',
  phase: 'evaluating',
  started_at: iso(now - 600000),
  updated_at: iso(now - 60000),
  ...over,
});
// classifyTask takes a record already parsed by the shared legacy-runs parser.
const parsedOf = r => ({ state: r.state, pid: r.pid ?? 0, startedAt: r.started_at });
const live = { now, isAlive: () => true, startTime: async () => new Date(now - 600000 + 1000) };

// Classification
assert.deepEqual(
  (await classifyTask({ state: 'completed' }, { now })).blocks,
  false,
  'terminal records never block',
);
let v = await classifyTask(parsedOf(running()), live);
assert.equal(v.state, 'running');
assert.equal(v.owner, 'live');
assert.equal(v.blocks, true);
v = await classifyTask(parsedOf(running()), { ...live, isAlive: () => false });
assert.equal(v.state, 'interrupted');
assert.equal(v.owner, 'gone');
assert.equal(v.blocks, false);
v = await classifyTask(parsedOf(running()), {
  ...live,
  startTime: async () => new Date(now - 10000),
});
assert.equal(v.owner, 'recycled', 'a live pid that started long after the record is not the owner');
assert.equal(v.blocks, false);
v = await classifyTask(parsedOf(running()), {
  ...live,
  startTime: async () => new Date(now - 3600000),
});
assert.equal(
  v.owner,
  'recycled',
  'a live pid that started long before the record is not the owner',
);
v = await classifyTask(parsedOf(running()), { ...live, startTime: async () => null });
assert.equal(v.owner, 'unknown');
assert.equal(
  v.blocks,
  true,
  'when the start time cannot be read the live pid is assumed to own it',
);
v = await classifyTask(parsedOf(running({ started_at: iso(now - 25 * 3600000) })), live);
assert.equal(v.state, 'interrupted');
assert.equal(v.blocks, false);
v = await classifyTask(parsedOf(running({ pid: undefined })), live);
assert.equal(v.blocks, false);
assert.match(v.reason, /no process id/);

// Audit over a directory with spaces in its name; nothing may be written.
const base = mkdtempSync(join(tmpdir(), 'career legacy tasks '));
try {
  const dir = join(base, 'logs dashboard', 'tasks');
  mkdirSync(dir, { recursive: true });
  const put = (name, value) =>
    writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  put('a-completed.json', {
    action: 'evaluate',
    number: 1,
    pid: 1,
    state: 'completed',
    started_at: iso(now - 7200000),
    finished_at: iso(now - 7000000),
  });
  put('b-failed.json', {
    action: 'cv',
    number: 2,
    pid: 2,
    state: 'failed',
    finished_at: iso(now - 90000),
  });
  put('c-running.json', running({ number: 3 }));
  put('d-broken.json', '{not json');
  put('f-unknown-action.json', { action: 'bogus', state: 'running', pid: 1 });
  put('e-note.txt', 'ignored');
  const before = readdirSync(dir).map(n => [
    n,
    statSync(join(dir, n)).mtimeMs,
    readFileSync(join(dir, n), 'utf8'),
  ]);
  const report = await auditTasks(dir, live);
  const after = readdirSync(dir).map(n => [
    n,
    statSync(join(dir, n)).mtimeMs,
    readFileSync(join(dir, n), 'utf8'),
  ]);
  assert.deepEqual(after, before, 'audit is read-only');
  assert.equal(report.total, 5);
  assert.equal(report.blockers, 1);
  assert.equal(report.cutoverBlocked, true);
  assert.equal(report.unreadable, 2);
  assert.deepEqual(report.counts, { completed: 1, failed: 1, running: 1, unreadable: 2 });
  assert.equal(report.tasks.find(t => t.number === 3).ageSeconds, 60);
  assert.equal(report.tasks[0].number, 3, 'newest first');
  assert.ok(!JSON.stringify(report).includes('"log"'), 'log paths are not echoed');
  const text = formatReport(report);
  assert.match(text, /CUTOVER BLOCKED: 1 task/);
  assert.match(text, /BLOCKS running/);
  assert.match(text, /1 finished record\(s\) hidden|2 finished record\(s\) hidden/);
  assert.match(text, /could not be read/);

  // Missing directory is an empty, unblocked report.
  const empty = await auditTasks(join(base, 'nope'), live);
  assert.equal(empty.total, 0);
  assert.equal(empty.cutoverBlocked, false);

  // Real process: a live child owns the record, then is stopped and the record becomes unblocked.
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await new Promise(r => setTimeout(r, 500));
    put('c-running.json', running({ pid: child.pid, started_at: new Date().toISOString() }));
    const alive = await auditTasks(dir);
    const task = alive.tasks.find(t => t.number === 7 || t.pid === child.pid);
    assert.equal(task.blocks, true, 'a really running owner blocks cutover');
    assert.ok(['live', 'unknown'].includes(task.owner));
    child.kill();
    await new Promise(r => child.once('exit', r));
    const gone = await auditTasks(dir);
    assert.equal(gone.tasks.find(t => t.pid === child.pid).blocks, false);
  } finally {
    child.kill();
  }

  // An explicit --dir that does not exist is an error; the default directory may be missing.
  const errors = [];
  const originalError = console.error;
  console.error = line => errors.push(line);
  try {
    assert.equal(await main(['--dir=' + join(base, 'nope')]), 1);
    assert.match(errors.join(' '), /Task directory not found/);
  } finally {
    console.error = originalError;
  }

  // CLI entry: exit code reflects blockers and --json is parseable.
  const lines = [];
  const original = console.log;
  console.log = line => lines.push(line);
  try {
    put('c-running.json', running({ state: 'completed' }));
    assert.equal(await main(['--json', '--dir=' + dir]), 0);
    assert.equal(JSON.parse(lines.pop()).cutoverBlocked, false);
  } finally {
    console.log = original;
  }
} finally {
  if (
    dirname(base) !== resolve(tmpdir()) ||
    !base.startsWith(join(resolve(tmpdir()), 'career legacy tasks '))
  )
    throw new Error('Unsafe test cleanup');
  rmSync(base, { recursive: true, force: true });
}
console.log('Legacy task audit tests passed');
