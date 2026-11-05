import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  wrapCoverLetter,
  candidateName,
  candidateFileStem,
  withOutputLock,
  resolveJob,
  jobOutputPath,
  customizationContext,
} from './_cv-drafting.mjs';
const test = mkdtempSync(join(tmpdir(), 'career-cvgen-test-'));
try {
  for (const punctuation of [')', '.'])
    for (const newline of ['\n', '\r\n']) {
      const report = [
        '## E' + punctuation + ' Customization Plan',
        '',
        'First paragraph.',
        '',
        'Second paragraph.',
        '',
        '## F' + punctuation + ' Posting Legitimacy',
        '',
        'Excluded.',
      ].join(newline);
      assert.equal(
        customizationContext(report),
        ['First paragraph.', '', 'Second paragraph.'].join(newline),
      );
    }
  assert.equal(customizationContext('## E) Customization Plan\n\nLast section.'), 'Last section.');
  assert.match(customizationContext(''), /No evaluation/);
  mkdirSync(join(test, 'config'));
  writeFileSync(join(test, 'config/profile.yml'), 'candidate:\n  full_name: "Test Candidate"\n');
  assert.equal(candidateName(test), 'Test Candidate');
  assert.equal(candidateFileStem(test), 'cv-test-candidate');
  const posting = { company: 'Example', role: 'Engineer', id: 101 };
  assert.notEqual(jobOutputPath(test, posting), jobOutputPath(test, { ...posting, id: 102 }));
  assert.ok(jobOutputPath(test, posting).endsWith('engineer--101'));
  assert.throws(() => jobOutputPath(test, { ...posting, id: '../1' }), /positive ID/);
  assert.equal(
    wrapCoverLetter('A factual letter body. ', 'Test Candidate'),
    'Dear hiring team,\n\nA factual letter body.\n\nThank you,\nTest Candidate\n',
  );
  writeFileSync(join(test, 'config/profile.yml'), 'candidate:\n  email: x\n');
  assert.throws(() => candidateName(test), /full_name/);
  const archive = join(test, 'logs', 'drafting');
  mkdirSync(archive, { recursive: true });
  const out = join(test, 'output', 'acme', 'engineer');
  let ran = false,
    letterRan = false;
  await withOutputLock(archive, out, 'cv', 'run-1', async () => {
    ran = true;
    assert.ok(existsSync(join(archive, 'locks')));
    await assert.rejects(
      withOutputLock(archive, out, 'cv', 'run-2', async () => {}),
      /Another cv draft owns/,
    );
    // The letter writes different files, so it runs beside a CV draft.
    await withOutputLock(archive, out, 'letter', 'run-2', async () => {
      letterRan = true;
    });
  });
  assert.ok(ran && letterRan);
  await withOutputLock(archive, out, 'cv', 'run-3', async () => {});
  // A draft killed mid-run leaves its lock behind; the next run reclaims it
  // once the recorded owner is gone, instead of blocking the role forever.
  const abandoned = join(
    archive,
    'locks',
    out
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '.cv.lock',
  );
  const staleLocks = [
    JSON.stringify({ runId: 'killed', pid: 2147483646, startedAt: new Date().toISOString() }),
    JSON.stringify({ runId: 'ancient', pid: process.pid, startedAt: '2020-01-01T00:00:00.000Z' }),
    'legacy-run-id-without-owner',
  ];
  for (const contents of staleLocks) {
    mkdirSync(dirname(abandoned), { recursive: true });
    writeFileSync(abandoned, contents);
    let reclaimed = false;
    await withOutputLock(archive, out, 'cv', 'run-4', async () => {
      reclaimed = true;
    });
    assert.ok(reclaimed, 'stale lock was not reclaimed: ' + contents);
    assert.ok(!existsSync(abandoned), 'lock survived its own run');
  }
  // A lock whose owner is this live process is never reclaimed.
  writeFileSync(
    abandoned,
    JSON.stringify({ runId: 'live', pid: process.pid, startedAt: new Date().toISOString() }),
  );
  await assert.rejects(
    withOutputLock(archive, out, 'cv', 'run-5', async () => {}),
    /Another cv draft owns this output folder \(run live, pid/,
  );
  rmSync(abandoned);
  await assert.rejects(resolveJob(test, '../123'), /permanent numeric ID/);
  console.log(
    'CV drafting helper tests passed: identity from profile.yml, letter wrapper, per-artifact output lock with stale-owner recovery and job ID validation.',
  );
} finally {
  if (
    dirname(test) !== resolve(tmpdir()) ||
    !test.startsWith(join(resolve(tmpdir()), 'career-cvgen-test-'))
  )
    throw new Error('Unsafe test cleanup');
  rmSync(test, { recursive: true, force: true });
}
