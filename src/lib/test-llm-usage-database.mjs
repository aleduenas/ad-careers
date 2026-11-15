import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { root } from './root.mjs';
import {
  aggregateCalls,
  countCalls,
  cubeCalls,
  parseUsage,
  readCalls,
  recordCall,
} from './_llm-usage.mjs';
import {
  applyBackfill,
  applyRepairs,
  planBackfill,
  planRepairs,
} from '../helpers/import-llm-usage.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL LLM usage integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_llm_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
const pools = [];
const openPool = () => {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: u.toString(), max: 12 });
  pools.push(pool);
  return pool;
};
const fixtureRoot = mkdtempSync(join(tmpdir(), 'llm-usage-'));
let schemaCreated = false;

const claudeLog = (inputTokens, outputTokens) =>
  JSON.stringify({
    type: 'result',
    duration_ms: 10,
    total_cost_usd: 0.01,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    modelUsage: {
      'model-a': {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 1,
      },
    },
  });
const codexLog =
  '{"type":"thread.started"}\n' +
  JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 10,
      reasoning_output_tokens: 3,
    },
  }) +
  '\n';

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await admin.query(`SET search_path TO "${schema}"`);
  const migrations = readdirSync(join(root, 'infra/sql/migrations'))
    .filter(n => n.endsWith('.sql'))
    .sort();
  assert.ok(migrations.includes('011_llm_calls.sql'), 'migration 011 is present');
  assert.ok(migrations.includes('012_llm_calls_estimate_source.sql'), 'migration 012 is present');
  for (const name of migrations)
    await admin.query(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));

  let pool = openPool();
  const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
  const query = (sql, args) => pool.query(sql, args).then(r => r.rows);

  // Empty database: zeros, not errors.
  const empty = await aggregateCalls({ range: 'all', query });
  assert.equal(empty.totals.calls, 0);
  assert.equal(empty.totals.inputTokens, 0);
  assert.deepEqual([empty.byModel, empty.byFunction, empty.byJob, empty.byDay], [[], [], [], []]);
  assert.equal(empty.since, null);
  assert.deepEqual(await readCalls({ query }), []);

  const [{ id: jobA }] = await q(
    "INSERT INTO jobs (company, role) VALUES ('Acme','Engineer') RETURNING id::text AS id",
  );
  const [{ id: jobB }] = await q(
    "INSERT INTO jobs (company, role) VALUES ('Globex','Analyst') RETURNING id::text AS id",
  );
  const before = await q('SELECT count(*)::int AS n FROM jobs');

  const usage = parseUsage('claude', claudeLog(100, 50));
  const base = { provider: 'claude', model: 'model-a', function: 'evaluation', usage };
  await recordCall({ ...base, jobId: jobA, calledAt: new Date().toISOString() }, { query });
  await recordCall(
    {
      ...base,
      function: 'gate',
      jobId: jobA,
      calledAt: new Date(Date.now() - 3600e3).toISOString(),
    },
    { query },
  );
  await recordCall(
    {
      provider: 'codex',
      model: 'model-c',
      function: 'cv',
      jobId: jobB,
      usage: parseUsage('codex', codexLog),
      calledAt: new Date(Date.now() - 40 * 86400e3).toISOString(),
    },
    { query },
  );
  // A call without usage: zero row flagged usage_missing, no job.
  await recordCall(
    { provider: 'claude', model: 'model-a', function: 'intake', usage: null },
    { query },
  );

  const rows = await q('SELECT * FROM llm_calls ORDER BY id');
  assert.equal(rows.length, 4);
  assert.deepEqual(
    [
      rows[0].input_tokens,
      rows[0].cache_read_tokens,
      rows[0].cache_write_tokens,
      rows[0].output_tokens,
    ],
    ['100', '5', '1', '50'],
  );
  assert.equal(rows[0].source, 'live');
  assert.deepEqual(
    [rows[3].usage_missing, rows[3].input_tokens, rows[3].job_id],
    [true, '0', null],
  );
  assert.equal(rows[2].input_tokens, '60', 'codex input excludes the cached share');

  // Constraints are enforced by PostgreSQL, not by the caller.
  await assert.rejects(
    q("INSERT INTO llm_calls (provider,model,function) VALUES ('other','m','cv')"),
    /check/i,
  );
  await assert.rejects(
    q(
      "INSERT INTO llm_calls (provider,model,function,usage_missing,output_tokens) VALUES ('claude','m','cv',true,5)",
    ),
    /check/i,
  );
  await assert.rejects(
    q(
      "INSERT INTO llm_calls (provider,model,function,output_tokens,reasoning_tokens) VALUES ('claude','m','cv',1,2)",
    ),
    /check/i,
  );
  await assert.rejects(
    q("INSERT INTO llm_calls (provider,model,function,job_id) VALUES ('claude','m','cv',999999)"),
    /foreign key/i,
  );

  // Aggregates.
  const day30 = await aggregateCalls({ range: '30d', query });
  assert.equal(day30.totals.calls, 3, 'the 40 day old call is outside 30d');
  assert.equal(day30.totals.inputTokens, 200);
  assert.equal(day30.totals.missingCalls, 1);
  assert.deepEqual(day30.byFunction.map(r => r.function).sort(), ['evaluation', 'gate', 'intake']);
  assert.equal(day30.byJob.length, 1);
  assert.deepEqual(
    [day30.byJob[0].jobId, day30.byJob[0].company, day30.byJob[0].calls],
    [Number(jobA), 'Acme', 2],
  );
  const all = await aggregateCalls({ range: 'all', query });
  assert.equal(all.totals.calls, 4);
  assert.deepEqual(all.byModel.map(r => r.model).sort(), ['model-a', 'model-c']);
  assert.ok(all.byDay.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.day)));
  assert.equal((await aggregateCalls({ range: '7d', query })).totals.calls, 3);
  await assert.rejects(aggregateCalls({ range: '1y', query }), /range/);
  const listed = await readCalls({ range: 'all', limit: 2, query });
  assert.equal(listed.length, 2);
  assert.ok(listed[0].calledAt >= listed[1].calledAt, 'newest first');
  assert.deepEqual(
    (await readCalls({ range: 'all', jobId: jobB, query })).map(r => r.function),
    ['cv'],
  );
  await assert.rejects(readCalls({ jobId: 'x', query }), /jobId/);

  // cubeCalls and countCalls.
  const cube = await cubeCalls({ range: 'all', query });
  assert.equal(cube.since, null);
  assert.equal(
    cube.rows.reduce((n, r) => n + r.calls, 0),
    4,
  );
  const gateRow = cube.rows.find(r => r.function === 'gate');
  assert.deepEqual(
    [gateRow.jobId, gateRow.company, gateRow.role, gateRow.model],
    [Number(jobA), 'Acme', 'Engineer', 'model-a'],
  );
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(gateRow.day));
  assert.equal(gateRow.reportedCostUsd, 0.01);
  assert.equal(gateRow.reportedCostCalls, 1);
  assert.deepEqual(gateRow.unreported, {
    calls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  });
  const cvRow = cube.rows.find(r => r.function === 'cv');
  assert.deepEqual(
    cvRow.unreported,
    { calls: 1, inputTokens: 60, cacheReadTokens: 40, cacheWriteTokens: 0, outputTokens: 10 },
    'codex call is unreported',
  );
  assert.deepEqual(
    [cvRow.reportedCostUsd, cvRow.reportedCostCalls],
    [0, 0],
    'codex has no reported cost',
  );
  assert.equal((await cubeCalls({ range: '30d', query })).rows.length, 3);
  assert.equal(await countCalls({ range: 'all', query }), 4);
  assert.equal(await countCalls({ range: '30d', query }), 3);
  assert.equal(await countCalls({ range: 'all', jobId: jobA, query }), 2);
  await assert.rejects(countCalls({ jobId: 'x', query }), /jobId/);
  assert.equal((await readCalls({ range: 'all', query }))[0].requestedModel, null);
  assert.equal(
    (await q("SELECT requested_model FROM llm_calls WHERE function='gate'"))[0].requested_model,
    null,
  );

  // Race: concurrent inserts of one log_ref leave exactly one row.
  const ref = 'logs/evaluation/race/1/gate-1-0.stdout.log';
  const results = await Promise.all(
    Array.from({ length: 12 }, () => recordCall({ ...base, logRef: ref }, { query })),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM llm_calls WHERE log_ref=$1', [ref]))[0].n,
    1,
  );

  // Backfill from fixture logs: derived fields, idempotence, no job-table writes.
  const run = join(fixtureRoot, 'logs', 'evaluation', '2026-09-18T19-14-30-487Z-aaaa');
  mkdirSync(join(run, jobA), { recursive: true });
  mkdirSync(join(run, '99999'), { recursive: true });
  mkdirSync(join(run, 'companies', 'acme'), { recursive: true });
  writeFileSync(join(run, 'run.json'), JSON.stringify({ provider: 'claude' }));
  writeFileSync(join(run, jobA, 'gate-1789914950925-0.stdout.log'), claudeLog(10, 2));
  writeFileSync(join(run, jobA, 'evaluation-1789914950926-1.stdout.log'), codexLog);
  writeFileSync(join(run, '99999', 'market-1789914950927-0.stdout.log'), 'broken output');
  writeFileSync(
    join(run, 'companies', 'acme', 'research-1789914950928-0.stdout.log'),
    claudeLog(7, 3),
  );
  writeFileSync(join(run, jobA, 'unknown-phase-1789914950929-0.stdout.log'), claudeLog(1, 1));
  const draft = join(fixtureRoot, 'logs', 'drafting', 'runs', '2026-09-17T22-21-48-962Z-431b5565');
  mkdirSync(draft, { recursive: true });
  writeFileSync(
    join(draft, 'draft-usage.json'),
    JSON.stringify({ usage: { input_tokens: 4, output_tokens: 2 }, duration_ms: 5 }),
  );
  const known = new Set((await q('SELECT id::text AS id FROM jobs')).map(r => r.id));
  const plan = planBackfill(fixtureRoot, { knownJobs: known });
  assert.equal(plan.rows.length, 5);
  assert.equal(plan.skipped.length, 1);
  const by = fn => plan.rows.filter(r => r.function === fn);
  assert.equal(by('gate')[0].jobId, jobA);
  assert.equal(by('gate')[0].model, 'model-a');
  assert.equal(by('evaluation')[0].provider, 'codex');
  assert.equal(by('market')[0].jobId, null, 'a job id the table does not know becomes null');
  assert.equal(by('market')[0].usage, null);
  assert.equal(by('companyResearch')[0].jobId, null);
  assert.equal(by('cv')[0].provider, 'claude');
  assert.equal(by('gate')[0].calledAt, new Date(1789914950925).toISOString());

  const first = await applyBackfill(plan.rows, { query });
  assert.deepEqual(first, { inserted: 5, alreadyPresent: 0 });
  const second = await applyBackfill(plan.rows, { query });
  assert.deepEqual(second, { inserted: 0, alreadyPresent: 5 });
  const filled = await q("SELECT count(*)::int AS n FROM llm_calls WHERE source='backfill'");
  assert.equal(filled[0].n, 5);
  assert.equal(
    (
      await q('SELECT count(*)::int AS n FROM llm_calls WHERE usage_missing AND source=$1', [
        'backfill',
      ])
    )[0].n,
    1,
  );
  assert.deepEqual(await q('SELECT count(*)::int AS n FROM jobs'), before, 'no job rows touched');
  for (const t of ['evaluations', 'job_status_events', 'job_descriptions'])
    assert.equal((await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n, 0, t + ' untouched');

  // Repair: a recorded row with no job gets the job its path yields; a set job is never changed.
  const gate = plan.rows.find(r => r.function === 'gate');
  const evalRow = plan.rows.find(r => r.function === 'evaluation');
  await q('UPDATE llm_calls SET job_id=NULL WHERE log_ref=$1', [gate.logRef]);
  await q('UPDATE llm_calls SET job_id=$2::bigint WHERE log_ref=$1', [evalRow.logRef, jobB]);
  const recorded = new Map(
    (
      await q('SELECT log_ref, job_id::text AS job_id FROM llm_calls WHERE log_ref IS NOT NULL')
    ).map(r => [r.log_ref, r.job_id]),
  );
  const repairs = planRepairs(plan.rows, recorded);
  assert.deepEqual(
    repairs.map(r => r.logRef),
    [gate.logRef],
    'only the null-job row is a candidate',
  );
  assert.equal(await applyRepairs(repairs, { query }), 1);
  assert.equal(
    (await q('SELECT job_id::text AS j FROM llm_calls WHERE log_ref=$1', [gate.logRef]))[0].j,
    jobA,
  );
  assert.equal(
    (await q('SELECT job_id::text AS j FROM llm_calls WHERE log_ref=$1', [evalRow.logRef]))[0].j,
    jobB,
    'a set job id is never overwritten',
  );
  assert.equal(await applyRepairs(repairs, { query }), 0, 'repair is idempotent');

  // Restart: a new pool (new connections) sees the same rows and keeps deduplicating.
  await pool.end();
  pool = openPool();
  assert.equal((await aggregateCalls({ range: 'all', query })).totals.calls, 4 + 1 + 5);
  assert.deepEqual(await applyBackfill(plan.rows, { query }), { inserted: 0, alreadyPresent: 5 });

  // Migration 012: estimated rows. The source CHECK accepts 'estimate' and nothing else new.
  await assert.rejects(
    q("INSERT INTO llm_calls (provider,model,function,source) VALUES ('claude','m','cv','guess')"),
    /check/i,
  );
  const estimate = {
    provider: 'claude',
    model: 'model-a',
    function: 'cv',
    jobId: jobA,
    source: 'estimate',
    logRef: 'logs/drafting/runs/2026-09-20T10-00-00-000Z-aaaa1111/response.json',
    calledAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
    usage: {
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 200,
      outputTokens: 50,
      reasoningTokens: 20,
      reportedCostUsd: null,
    },
  };
  assert.ok(await recordCall(estimate, { query }));
  assert.equal(await recordCall(estimate, { query }), null, 'an estimate is idempotent on log_ref');
  const stored = (
    await q(
      "SELECT source, usage_missing, reported_cost_usd FROM llm_calls WHERE source='estimate'",
    )
  )[0];
  assert.deepEqual(
    [stored.source, stored.usage_missing, stored.reported_cost_usd],
    ['estimate', false, null],
  );
  // Include and exclude on every reader; the cube counts estimated calls.
  const total = await countCalls({ range: 'all', query });
  assert.equal(await countCalls({ range: 'all', estimates: 'exclude', query }), total - 1);
  assert.equal(await countCalls({ range: 'all', estimates: 'include', query }), total);
  assert.equal(
    (await readCalls({ range: 'all', limit: 500, query })).filter(r => r.source === 'estimate')
      .length,
    1,
  );
  assert.equal(
    (await readCalls({ range: 'all', limit: 500, estimates: 'exclude', query })).filter(
      r => r.source === 'estimate',
    ).length,
    0,
  );
  const withEst = await cubeCalls({ range: 'all', query });
  const noEst = await cubeCalls({ range: 'all', estimates: 'exclude', query });
  assert.equal(
    withEst.rows.reduce((n, r) => n + r.estimatedCalls, 0),
    1,
  );
  assert.equal(
    noEst.rows.reduce((n, r) => n + r.estimatedCalls, 0),
    0,
  );
  assert.equal(
    withEst.rows.reduce((n, r) => n + r.calls, 0) - noEst.rows.reduce((n, r) => n + r.calls, 0),
    1,
    'summary with and without estimates reconciles',
  );
  const estRow = withEst.rows.find(r => r.estimatedCalls === 1);
  assert.deepEqual(
    [estRow.unreported.calls, estRow.unreported.cacheWriteTokens, estRow.reportedCostCalls],
    [1, 200, 0],
    'estimates are unreported and priced from the table',
  );
  await assert.rejects(countCalls({ estimates: 'maybe', query }), /estimates/);

  console.log('LLM usage database tests passed');
} finally {
  for (const pool of pools) await pool.end().catch(() => {});
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await admin.end().catch(() => {});
  rmSync(fixtureRoot, { recursive: true, force: true });
}
