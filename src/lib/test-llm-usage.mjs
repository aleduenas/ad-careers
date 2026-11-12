import assert from 'node:assert/strict';
import { parseUsage, recordCall, recordCallSafe } from './_llm-usage.mjs';
import { processRun } from './cli-runtime.mjs';
import { usageFunction } from '../eval/_evaluation-cli.mjs';

const claude = JSON.stringify({
  type: 'result',
  is_error: false,
  result: 'x',
  duration_ms: 1234,
  total_cost_usd: 0.05,
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 3000,
    output_tokens: 500,
    output_tokens_details: { thinking_tokens: 120 },
  },
  modelUsage: {
    'model-a': {
      inputTokens: 10,
      outputTokens: 400,
      cacheReadInputTokens: 3000,
      cacheCreationInputTokens: 200,
    },
    'model-b': {
      inputTokens: 5,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  },
});
// Claude: all models summed; input is uncached only; reasoning stays inside output.
assert.deepEqual(parseUsage('claude', claude), {
  model: 'model-a',
  inputTokens: 15,
  cacheReadTokens: 3000,
  cacheWriteTokens: 200,
  outputTokens: 500,
  reasoningTokens: 120,
  reportedCostUsd: 0.05,
  durationMs: 1234,
});
// Claude without modelUsage falls back to top-level usage.
const flat = JSON.parse(claude);
delete flat.modelUsage;
assert.equal(parseUsage('claude', JSON.stringify(flat)).inputTokens, 10);

const codex = [
  '{"type":"thread.started"}',
  'not json',
  JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 1000,
      cached_input_tokens: 400,
      cache_write_input_tokens: 0,
      output_tokens: 90,
      reasoning_output_tokens: 30,
    },
  }),
].join('\n');
// Codex input_tokens includes the cached share; only the uncached remainder is stored.
assert.deepEqual(parseUsage('codex', codex), {
  model: null,
  inputTokens: 600,
  cacheReadTokens: 400,
  cacheWriteTokens: 0,
  outputTokens: 90,
  reasoningTokens: 30,
  reportedCostUsd: null,
  durationMs: null,
});

// No usable usage gives null (the caller records a zero usage_missing row).
for (const [provider, text] of [
  ['claude', ''],
  ['claude', '{"usage":{}}'],
  ['claude', 'plain text'],
  ['codex', '{"type":"turn.started"}'],
  ['codex', ''],
  ['other', claude],
])
  assert.equal(parseUsage(provider, text), null, provider + ' ' + text.slice(0, 20));

assert.equal(usageFunction('research'), 'companyResearch');
assert.equal(usageFunction('gate'), 'gate');
assert.equal(usageFunction('evaluation-smoke'), 'smoke');

// recordCall: the stored parameters, including the usage_missing row.
const calls = [];
const fake = async (sql, args) => {
  calls.push({ sql, args });
  return [{ id: 1 }];
};
await recordCall(
  {
    provider: 'claude',
    model: ' model-a ',
    requestedModel: 'alias',
    function: 'evaluation',
    jobId: '42',
    runId: 'not-a-uuid',
    usage: parseUsage('claude', claude),
    exitCode: 0,
  },
  { query: fake },
);
const a = calls[0].args;
// Real model id from the output wins; the requested alias is kept separately.
assert.deepEqual(a.slice(1, 7), ['claude', 'model-a', 'alias', 'evaluation', '42', null]);
assert.deepEqual(a.slice(7, 12), [15, 3000, 200, 500, 120]);
assert.equal(a[13], false);
await recordCall({ provider: 'codex', model: 'm', function: 'gate', usage: null }, { query: fake });
const m = calls[1].args;
assert.deepEqual(m.slice(7, 12), [0, 0, 0, 0, 0]);
assert.equal(m[13], true);
assert.equal(m[2], 'm');
assert.equal(m[3], null, 'no requested alias given');
await assert.rejects(
  recordCall({ provider: 'x', model: 'm', function: 'gate' }, { query: fake }),
  /provider/,
);
await assert.rejects(
  recordCall({ provider: 'claude', model: 'm', function: 'bad label' }, { query: fake }),
  /function/,
);

// A recording failure is reported on stderr and never thrown into the launcher.
const written = [];
const realWrite = process.stderr.write;
process.stderr.write = chunk => (written.push(String(chunk)), true);
try {
  await recordCallSafe(
    { provider: 'claude', model: 'm', fn: 'cv' },
    { code: 0, stdout: claude },
    5,
    {
      query: async () => {
        throw new Error('database down');
      },
    },
  );
} finally {
  process.stderr.write = realWrite;
}
assert.match(written.join(''), /LLM usage recording failed: database down/);

// processRun with a mocked child process (no model): records once per call, with the right counts.
async function mocked(provider, stdout, extra = {}) {
  const seen = [];
  const script = 'process.stdout.write(' + JSON.stringify(stdout) + ')';
  const result = await processRun(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    timeout: 30000,
    usage: {
      provider,
      model: 'mock-model',
      fn: 'evaluation',
      jobId: '7',
      logRef: extra.logRef,
      query: async (sql, args) => (seen.push(args), [{ id: 1 }]),
    },
  });
  assert.equal(result.code, 0);
  assert.equal(seen.length, 1);
  return seen[0];
}
const claudeRow = await mocked('claude', claude, { logRef: 'logs/evaluation/r/7/x.stdout.log' });
assert.deepEqual(claudeRow.slice(7, 12), [15, 3000, 200, 500, 120]);
assert.equal(claudeRow[17], 'logs/evaluation/r/7/x.stdout.log');
assert.equal(claudeRow[16], 'live');
assert.deepEqual(claudeRow.slice(2, 4), ['model-a', 'mock-model']);
const codexRow = await mocked('codex', codex);
assert.deepEqual(codexRow.slice(7, 12), [600, 400, 0, 90, 30]);
assert.deepEqual(codexRow.slice(2, 4), ['mock-model', 'mock-model'], 'codex names no model');
const missingRow = await mocked('claude', 'no usage here');
assert.deepEqual(missingRow.slice(7, 12), [0, 0, 0, 0, 0]);
assert.equal(missingRow[13], true);

console.log('LLM usage parsing and recording tests passed');
