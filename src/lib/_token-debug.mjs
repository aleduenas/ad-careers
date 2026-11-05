import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

export function usageFromResult(provider, stdout) {
  let envelope;
  try {
    envelope =
      provider === 'claude'
        ? JSON.parse(stdout)
        : stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(e => e?.type === 'turn.completed')
            .at(-1);
  } catch {
    return { available: false };
  }
  const u = envelope?.usage;
  const models = Object.values(envelope?.modelUsage || {});
  if (
    provider === 'claude' &&
    models.length &&
    models.every(m =>
      [m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens].every(
        Number.isFinite,
      ),
    )
  ) {
    const sum = key => models.reduce((n, m) => n + m[key], 0);
    const uncached = sum('inputTokens'),
      cacheRead = sum('cacheReadInputTokens'),
      cacheWrite = sum('cacheCreationInputTokens'),
      output = sum('outputTokens');
    const input = uncached + cacheRead + cacheWrite;
    return {
      available: true,
      accounting_basis: 'model_usage_all_models',
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
      uncached_input_tokens: uncached,
      raw_usage: u,
      model_usage: envelope.modelUsage,
      duration_ms: envelope.duration_ms ?? null,
    };
  }
  if (!u || !Number.isFinite(u.input_tokens) || !Number.isFinite(u.output_tokens))
    return { available: false };
  const cacheRead = u.cache_read_input_tokens ?? u.cached_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const input = provider === 'claude' ? u.input_tokens + cacheRead + cacheWrite : u.input_tokens;
  return {
    available: true,
    accounting_basis: 'top_level_usage',
    input_tokens: input,
    output_tokens: u.output_tokens,
    total_tokens: input + u.output_tokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    uncached_input_tokens: provider === 'claude' ? u.input_tokens : input - cacheRead,
    raw_usage: u,
    model_usage: envelope.modelUsage ?? null,
    duration_ms: envelope.duration_ms ?? null,
  };
}

// One file per request avoids interleaved writes from concurrent CLI processes.
// Debugging must never prevent a successful evaluation/draft from being delivered.
export function logTokenUsage(
  root,
  { provider, model, workflow, phase, runPath, stdout = '', code = null },
) {
  try {
    const toggle = join(root, 'logs', 'token-usage', 'debug.json');
    if (!existsSync(toggle) || JSON.parse(readFileSync(toggle, 'utf8')).enabled !== true) return;
    const dir = join(root, 'logs', 'token-usage');
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const record = {
      timestamp: now,
      workflow,
      phase,
      provider,
      model,
      run_path: relative(root, runPath),
      exit_code: code,
      ...usageFromResult(provider, stdout),
    };
    if (!record.available)
      record.note = 'CLI did not return token counters; usage is unknown, not zero.';
    writeFileSync(
      join(dir, now.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.json'),
      JSON.stringify(record, null, 2) + '\n',
    );
  } catch (error) {
    process.stderr.write('Token debug logging failed: ' + error.message + '\n');
  }
}
