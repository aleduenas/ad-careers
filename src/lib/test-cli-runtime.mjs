import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  subscriptionEnv,
  cliSpec,
  processRun,
  draftingRoot,
  temporaryWorker,
} from './cli-runtime.mjs';
const test = mkdtempSync(join(tmpdir(), 'career-runtime-test-'));
try {
  const repo = join(test, 'repo'),
    external = join(test, 'drafting');
  mkdirSync(repo);
  mkdirSync(external);
  assert.equal(draftingRoot(repo, 'logs/drafting'), join(repo, 'logs/drafting'));
  assert.throws(() => draftingRoot(repo, external));
  let scratch;
  await temporaryWorker(repo, async cwd => {
    scratch = cwd;
    assert.ok(cwd.startsWith(join(repo, 'logs', 'workers')));
    assert.ok(existsSync(cwd));
    writeFileSync(join(cwd, 'response.txt'), 'test');
  });
  assert.ok(!existsSync(scratch));
  await assert.rejects(
    temporaryWorker(repo, async cwd => {
      scratch = cwd;
      throw new Error('test failure');
    }),
    /test failure/,
  );
  assert.ok(!existsSync(scratch));
  assert.throws(() => draftingRoot(repo, repo));
  assert.throws(() => draftingRoot(repo, test));
  const env = subscriptionEnv({
    PATH: 'safe',
    OPENAI_API_KEY: 'secret',
    ANTHROPIC_API_KEY: 'secret',
    ANTHROPIC_BASE_URL: 'wrong',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDECODE: 'nested',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
  });
  assert.deepEqual(env, { PATH: 'safe', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' });
  const config = {
    claude_command: 'claude',
    claude_model: 'sonnet',
    codex_command: 'codex',
    codex_model: 'gpt-5.5',
  };
  const claude = cliSpec('claude', config, 'last.txt'),
    codex = cliSpec('codex', config, 'last.txt');
  assert.equal(claude.args[claude.args.indexOf('--tools') + 1], '');
  assert.ok(!claude.args.includes('--bare'));
  assert.ok(claude.args.includes('--safe-mode'));
  assert.ok(codex.args.includes('project_doc_max_bytes=0'));
  assert.equal(
    cliSpec('claude', config, 'last.txt', { research: true }).args.includes('WebSearch,WebFetch'),
    true,
  );
  assert.ok(codex.args.includes('read-only') && codex.args.includes('--ignore-user-config'));
  assert.equal(codex.args[codex.args.indexOf('--model') + 1], 'gpt-5.5');
  assert.throws(
    () => cliSpec('codex', { ...config, codex_model: null }, 'last.txt'),
    /explicit codex_model/,
  );
  for (const spec of [claude, codex]) assert.ok(!spec.args.some(s => s.includes('dangerously')));
  assert.throws(() => cliSpec('unknown', config, 'last.txt'));
  const r = await processRun(
    process.execPath,
    ['-e', 'process.stdin.on("data", b=>process.stdout.write(b));'],
    { cwd: external, input: 'literal `$(hello)` text', timeout: 5000 },
  );
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'literal `$(hello)` text');
  await assert.rejects(
    processRun(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], {
      cwd: external,
      timeout: 100,
    }),
    /timed out/,
  );
  console.log(
    'CLI runtime tests passed: folder isolation, subscription environment, provider arguments, literal stdin and timeout.',
  );
} finally {
  if (
    dirname(test) !== resolve(tmpdir()) ||
    !test.startsWith(join(resolve(tmpdir()), 'career-runtime-test-'))
  )
    throw new Error('Unsafe test cleanup');
  rmSync(test, { recursive: true, force: true });
}
