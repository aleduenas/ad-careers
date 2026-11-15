import assert from 'node:assert/strict';
import {
  ACTOR,
  REASON,
  createLivenessWriter,
  loadEligibleJobs,
  readLastFullCheck,
  storedAction,
} from './liveness-store.mjs';

process.env.CAREER_OPS_TEST_GUARD = '1';

assert.equal(ACTOR, 'liveness-check');
assert.equal(REASON, 'Posting expired');
assert.equal(storedAction({ action: 'discard' }), 'discarded');
assert.equal(storedAction({ action: 'flag' }), 'flagged');
assert.equal(storedAction({ action: 'flag', heldBack: true }), 'held_back');
assert.equal(storedAction({ action: 'none' }), 'none');

// loadEligibleJobs: only Pending, Evaluated, Applied; the two facts come from the query.
{
  const calls = [];
  const query = async (sql, args) => {
    calls.push({ sql, args });
    return [
      {
        id: '1',
        url: 'https://x.test/1',
        status: 'Pending',
        revision: '3',
        restored: true,
        active_task: false,
      },
      { id: '2', url: null, status: 'Applied', revision: '0', restored: false, active_task: true },
    ];
  };
  const jobs = await loadEligibleJobs(query);
  assert.deepEqual(jobs[0], {
    id: '1',
    url: 'https://x.test/1',
    status: 'Pending',
    revision: '3',
    restored: true,
    activeTask: false,
  });
  assert.equal(jobs[1].activeTask, true);
  assert.match(calls[0].sql, /status IN \('Pending','Evaluated','Applied'\)/);
  assert.match(calls[0].sql, /workflow_claims/);
  assert.match(calls[0].sql, /action<>'liveness'/);
  assert.match(calls[0].sql, /posting_checks/);
  assert.deepEqual(calls[0].args, [ACTOR]);
  await loadEligibleJobs(query, '7');
  assert.deepEqual(calls[1].args, [ACTOR, '7']);
  assert.match(calls[1].sql, /j\.id=\$2::bigint/);
}

// Writers: one insert per check; discard uses the fixed reason and actor; 40001 is a conflict.
{
  const calls = [];
  const writer = createLivenessWriter(async (sql, args) => {
    calls.push({ sql, args });
    if (/change_job_status/.test(sql) && args[0] === '9')
      throw Object.assign(new Error('Revision conflict'), { code: '40001' });
    if (/change_job_status/.test(sql) && args[0] === '8') throw new Error('boom');
    return [];
  });
  await writer.recordCheck(
    { id: '1' },
    { state: 'closed', method: 'greenhouse', detail: 'x'.repeat(500) },
    'discarded',
  );
  assert.match(calls[0].sql, /^INSERT INTO posting_checks/);
  assert.deepEqual(calls[0].args.slice(0, 3), ['1', 'closed', 'greenhouse']);
  assert.equal(calls[0].args[3].length, 300);
  assert.equal(calls[0].args[4], 'discarded');
  assert.equal(await writer.discard({ id: '1', revision: '4' }), 'discarded');
  assert.deepEqual(calls[1].args, ['1', '4', 'Discarded', 'Posting expired', 'liveness-check']);
  assert.equal(await writer.discard({ id: '9', revision: '1' }), 'conflict');
  await assert.rejects(writer.discard({ id: '8', revision: '1' }), /boom/);
}

// Summary: none without a completed whole-board run.
{
  assert.equal(await readLastFullCheck(async () => []), null);
  const finished = new Date('2026-11-15T05:00:00Z');
  const seen = [];
  const summary = await readLastFullCheck(async (sql, args) => {
    seen.push(args);
    if (/FROM browser_runs/.test(sql))
      return [{ started_at: new Date('2026-11-15T04:50:00Z'), finished_at: finished }];
    return [
      {
        checked: 10,
        open: 6,
        closed: 3,
        probably_closed: 1,
        unknown: 0,
        discarded: 2,
        flagged: 2,
        held_back: 1,
      },
    ];
  });
  assert.deepEqual(summary, {
    finishedAt: finished.toISOString(),
    checked: 10,
    open: 6,
    closed: 3,
    probablyClosed: 1,
    unknown: 0,
    discarded: 2,
    flagged: 2,
    heldBack: 1,
  });
  assert.equal(seen[1].length, 2);
}

console.log('liveness store tests OK');
