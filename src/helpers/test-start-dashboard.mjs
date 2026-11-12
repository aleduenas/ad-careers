import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRestartPolicy, parseArgs, rotateLog, serverArgs } from './dashboard-supervisor.mjs';

// Argument parsing
assert.deepEqual(parseArgs([], {}), { port: 4310 });
assert.deepEqual(parseArgs([], { PORT: '4400' }), { port: 4400 });
assert.deepEqual(parseArgs(['--port', '4500'], { PORT: '4400' }), { port: 4500 });
assert.throws(() => parseArgs(['--port', '0'], {}), /1 to 65535/);
assert.throws(() => parseArgs(['--port', 'abc'], {}), /1 to 65535/);
assert.throws(() => parseArgs(['--port'], {}), /1 to 65535/);
assert.throws(() => parseArgs([], { PORT: '70000' }), /1 to 65535/);

// First start builds; crash restarts reuse the build when one exists.
assert.deepEqual(serverArgs({ first: true, distExists: true }), ['--no-open']);
assert.deepEqual(serverArgs({ first: false, distExists: true }), ['--no-open', '--no-build']);
assert.deepEqual(serverArgs({ first: false, distExists: false }), ['--no-open']);

// Restart policy: growing delay, give up after five failures inside ten minutes.
const policy = createRestartPolicy();
const t0 = 1_000_000;
assert.deepEqual(
  [0, 1, 2, 3].map(i => policy.recordFailure(t0 + i * 1000).delayMs),
  [3000, 6000, 9000, 12000],
);
assert.equal(policy.recordFailure(t0 + 4000).giveUp, true);
const slow = createRestartPolicy();
for (let i = 0; i < 10; i++)
  assert.equal(
    slow.recordFailure(t0 + i * 11 * 60 * 1000).giveUp,
    false,
    'spread failures never give up',
  );
assert.equal(createRestartPolicy({ baseDelayMs: 20000 }).recordFailure(t0).delayMs, 20000);
const capped = createRestartPolicy({ limit: 99, baseDelayMs: 20000 });
let last;
for (let i = 0; i < 4; i++) last = capped.recordFailure(t0 + i);
assert.equal(last.delayMs, 30000, 'delay is capped');

// Log rotation under a path with spaces: keeps the current file plus two older ones.
const base = mkdtempSync(join(tmpdir(), 'career log rotate '));
try {
  const file = join(base, 'server.log');
  assert.equal(rotateLog(file, 10, 3), false, 'missing file');
  writeFileSync(file, 'small');
  assert.equal(rotateLog(file, 10, 3), false, 'under the limit');
  const fill = tag => writeFileSync(file, tag.repeat(20));
  fill('a');
  assert.equal(rotateLog(file, 10, 3), true);
  assert.equal(existsSync(file), false);
  fill('b');
  rotateLog(file, 10, 3);
  fill('c');
  rotateLog(file, 10, 3);
  fill('d');
  rotateLog(file, 10, 3);
  assert.match(readFileSync(file + '.1', 'utf8'), /^d/);
  assert.match(readFileSync(file + '.2', 'utf8'), /^c/);
  assert.equal(existsSync(file + '.3'), false, 'only three files are kept');
} finally {
  if (
    dirname(base) !== resolve(tmpdir()) ||
    !base.startsWith(join(resolve(tmpdir()), 'career log rotate '))
  )
    throw new Error('Unsafe test cleanup');
  rmSync(base, { recursive: true, force: true });
}
console.log('Dashboard supervisor tests passed: arguments, restart policy and log rotation');
