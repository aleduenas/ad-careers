import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { usageFromResult, logTokenUsage } from './_token-debug.mjs';
const claude = JSON.stringify({
  usage: {
    input_tokens: 100,
    output_tokens: 25,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 50,
  },
});
assert.equal(usageFromResult('claude', claude).total_tokens, 375);
const broad = usageFromResult(
  'claude',
  JSON.stringify({
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {
      main: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 50,
      },
      helper: {
        inputTokens: 30,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
  }),
);
assert.equal(broad.total_tokens, 405);
assert.equal(broad.accounting_basis, 'model_usage_all_models');
const codex = JSON.stringify({
  type: 'turn.completed',
  usage: { input_tokens: 300, cached_input_tokens: 200, output_tokens: 25 },
});
assert.equal(usageFromResult('codex', codex).total_tokens, 325);
assert.equal(usageFromResult('codex', codex).uncached_input_tokens, 100);
assert.equal(usageFromResult('claude', 'invalid').available, false);
const base = resolve('logs', 'tests', 'token-debug');
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, 'run-'));
try {
  mkdirSync(join(root, 'logs', 'token-usage'), { recursive: true });
  const toggle = join(root, 'logs', 'token-usage', 'debug.json');
  writeFileSync(toggle, '{"enabled":true}');
  const request = {
    provider: 'claude',
    model: 'sonnet',
    workflow: 'evaluation',
    phase: 'gate',
    runPath: root,
    stdout: claude,
    code: 0,
  };
  logTokenUsage(root, request);
  logTokenUsage(root, request);
  const dir = join(root, 'logs', 'token-usage');
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'debug.json');
  assert.equal(files.length, 2);
  assert.equal(JSON.parse(readFileSync(join(dir, files[0]))).total_tokens, 375);
  writeFileSync(toggle, '{"enabled":false}');
  logTokenUsage(root, request);
  assert.equal(readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'debug.json').length, 2);
  console.log(
    'Token debug tests passed: cache accounting, missing counters, unique request files and disable toggle.',
  );
} finally {
  if (dirname(root) !== base) throw new Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
}
