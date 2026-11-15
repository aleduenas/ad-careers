import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ESTIMATE_CONSTANTS,
  callFiles,
  estimateCall,
  folderTime,
  planEstimates,
  summarizeEstimates,
} from './_llm-estimate.mjs';

const root = mkdtempSync(join(tmpdir(), 'llm-estimate-'));
const runs = join(root, 'logs', 'drafting', 'runs');
const at = iso => new Date(iso);
function put(dir, name, bytes, when) {
  writeFileSync(join(dir, name), 'x'.repeat(bytes));
  utimesSync(join(dir, name), at(when), at(when));
}
function run(name, files, jd = null, runJson = null) {
  const dir = join(runs, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, bytes, when] of files) put(dir, file, bytes, when);
  if (jd) writeFileSync(join(dir, 'job-description.md'), `---\ncompany: X\nurl: ${jd}\n---\nbody`);
  if (runJson) writeFileSync(join(dir, 'draft-run.json'), JSON.stringify(runJson));
  return dir;
}

try {
  // Calibration arithmetic.
  const c = estimateCall({
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    promptChars: 50000,
    responseChars: 5000,
    seconds: 10,
  });
  assert.deepEqual(c.usage, {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 18200,
    outputTokens: 1950,
    reasoningTokens: 0,
    reportedCostUsd: null,
  });
  // Visible output (0.39 x 5000 = 1950) exceeds duration x speed (1580): no negative thinking.
  const slow = estimateCall({
    provider: 'claude',
    model: 'claude-sonnet-5',
    promptChars: 1000,
    responseChars: 1000,
    seconds: 20,
  });
  assert.equal(slow.usage.outputTokens, 2300);
  assert.equal(slow.usage.reasoningTokens, 2300 - 390);
  assert.equal(
    slow.usage.inputTokens + slow.usage.cacheWriteTokens,
    Math.round(1000 * ESTIMATE_CONSTANTS.claude.inputTokensPerChar),
    'the split keeps the measured total',
  );
  const cx = estimateCall({
    provider: 'codex',
    model: 'x',
    promptChars: 58303,
    responseChars: 2069,
    seconds: 17.339,
  });
  assert.equal(cx.usage.inputTokens + cx.usage.cacheReadTokens, 23718);
  assert.equal(cx.usage.outputTokens, 395);
  assert.ok(cx.usage.reasoningTokens > 0 && cx.usage.reasoningTokens < 60);
  assert.equal(folderTime('2026-09-17T22-21-48-962Z-abc'), Date.parse('2026-09-17T22:21:48.962Z'));

  // Current layout CV run: first call plus one repair, job linked by URL, claude from draft-run.json.
  run(
    '2026-09-20T10-00-00-000Z-aaaa1111',
    [
      ['cli-context.md', 1000, '2026-09-20T10:00:00Z'],
      ['response.json', 500, '2026-09-20T10:00:20Z'],
      ['repair-1-context.md', 2000, '2026-09-20T10:00:21Z'],
      ['repair-1-response.json', 100, '2026-09-20T10:00:31Z'],
    ],
    'https://jobs.example/1',
    { provider: 'claude' },
  );
  // Letter run: no draft-run.json; assumed codex.
  run(
    '2026-10-02T09-00-00-000Z-letter-bbbb2222',
    [
      ['cli-context.md', 5000, '2026-10-02T09:00:00Z'],
      ['response.md', 800, '2026-10-02T09:00:15Z'],
    ],
    'https://jobs.example/2',
  );
  // Ambiguous URL (two jobs) leaves job null; a dry run without a response is skipped.
  run(
    '2026-10-03T09-00-00-000Z-cccc3333',
    [
      ['cli-context.md', 1000, '2026-10-03T09:00:00Z'],
      ['response.json', 500, '2026-10-03T09:00:10Z'],
    ],
    'https://jobs.example/dup',
    { provider: 'codex' },
  );
  run('2026-10-04T09-00-00-000Z-dddd4444', [['cli-context.md', 1000, '2026-10-04T09:00:00Z']]);
  // Run with a measured row inside its window, and one matched by log_ref prefix.
  run(
    '2026-10-05T09-00-00-000Z-eeee5555',
    [
      ['cli-context.md', 1000, '2026-10-05T09:00:00Z'],
      ['response.json', 500, '2026-10-05T09:00:10Z'],
    ],
    null,
    { provider: 'claude' },
  );
  run(
    '2026-10-06T09-00-00-000Z-ffff6666',
    [
      ['cli-context.md', 1000, '2026-10-06T09:00:00Z'],
      ['response.json', 500, '2026-10-06T09:00:10Z'],
    ],
    null,
    { provider: 'claude' },
  );
  // Oldest layout.
  run('2026-09-01T09-00-00-000Z-gggg7777', [
    ['draft-prompt.txt', 1000, '2026-09-01T09:00:00Z'],
    ['draft-response.txt', 500, '2026-09-01T09:00:10Z'],
    ['repair-1-prompt.txt', 1000, '2026-09-01T09:00:11Z'],
    ['repair-1-response.txt', 500, '2026-09-01T09:00:20Z'],
  ]);

  assert.equal(callFiles(join(runs, '2026-09-01T09-00-00-000Z-gggg7777')).length, 2);
  const measured = [
    { logRef: null, calledAt: '2026-10-05T09:00:12Z' },
    {
      logRef: 'logs/drafting/runs/2026-10-06T09-00-00-000Z-ffff6666/draft-usage.json',
      calledAt: '2020-01-01T00:00:00Z',
    },
  ];
  const plan = planEstimates(root, {
    measured,
    claudeModels: [
      { model: 'claude-sonnet-5', at: Date.parse('2026-09-17T00:00:00Z') },
      { model: 'claude-sonnet-5-5', at: Date.parse('2026-11-12T00:00:00Z') },
    ],
    jobsByUrl: new Map([
      ['https://jobs.example/1', ['11']],
      ['https://jobs.example/2', ['12']],
      ['https://jobs.example/dup', ['13', '14']],
    ]),
  });
  assert.deepEqual(plan.skipped, { noResponse: 1, measured: 2, alreadyEstimated: 0 });
  assert.equal(plan.rows.length, 2 + 1 + 1 + 2, 'cv 2 calls, letter 1, codex cv 1, old layout 2');
  const byRef = Object.fromEntries(
    plan.rows.map(r => [r.logRef.split('/').slice(-2).join('/'), r]),
  );
  const first = byRef['2026-09-20T10-00-00-000Z-aaaa1111/response.json'];
  assert.deepEqual(
    [first.provider, first.function, first.jobId, first.source, first.model],
    ['claude', 'cv', '11', 'estimate', 'claude-sonnet-5'],
  );
  assert.deepEqual(
    [first.runDate, first.runFolder],
    ['2026-09-20', '2026-09-20T10-00-00-000Z-aaaa1111'],
    'rows carry the run date the apply cutoff uses',
  );
  assert.equal(first.durationMs, 20000);
  assert.equal(first.calledAt, '2026-09-20T10:00:20.000Z');
  const repair = byRef['2026-09-20T10-00-00-000Z-aaaa1111/repair-1-response.json'];
  assert.equal(repair.durationMs, 10000);
  assert.equal(repair.usage.cacheWriteTokens + repair.usage.inputTokens, Math.round(2000 * 0.364));
  const letter = byRef['2026-10-02T09-00-00-000Z-letter-bbbb2222/response.md'];
  assert.deepEqual(
    [letter.provider, letter.function, letter.jobId],
    ['codex', 'coverLetter', '12'],
  );
  assert.equal(letter.model, ESTIMATE_CONSTANTS.codex.model);
  assert.equal(byRef['2026-10-03T09-00-00-000Z-cccc3333/response.json'].jobId, null);
  assert.ok(plan.assumptions.some(a => /letter runs record no provider/.test(a)));
  assert.ok(plan.assumptions.some(a => /without draft-run.json/.test(a)));
  const summary = summarizeEstimates(plan.rows, plan.plain);
  assert.ok(summary['2026-09 / cv / claude'].calls >= 3);
  assert.ok(summary['2026-10 / coverLetter / codex'].plainRatioOutputTokens > 0);

  // Idempotence: rows whose log_ref is already estimated are skipped.
  const again = planEstimates(root, {
    measured,
    existingRefs: new Set(plan.rows.map(r => r.logRef)),
  });
  assert.equal(again.rows.length, 0);
  assert.equal(again.skipped.alreadyEstimated, plan.rows.length);
  console.log('LLM drafting estimate tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
