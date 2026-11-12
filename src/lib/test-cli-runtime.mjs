import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  subscriptionEnv,
  cliSpec,
  processRun,
  quoteCmdArgument,
  resolveCommand,
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
  // Windows command resolution (F21): the resolver is platform-injectable, the shim test is real.
  const bin = join(test, 'bin');
  mkdirSync(bin);
  const names = ['both.exe', 'both.cmd', 'shim.cmd', 'tool.exe', 'only.bat'];
  for (const name of names) writeFileSync(join(bin, name), '');
  const present = new Set(names.map(name => join(bin, name).toLowerCase()));
  const fakeEnv = { Path: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const plan = (name, args = []) =>
    resolveCommand(name, args, {
      platform: 'win32',
      env: fakeEnv,
      exists: candidate => present.has(candidate.toLowerCase()),
    });
  assert.equal(plan('both').command, join(bin, 'both.exe'), 'exe is preferred over cmd');
  assert.equal(plan('tool').windowsVerbatimArguments, false);
  assert.deepEqual(plan('tool', ['--x']).args, ['--x']);
  const shim = plan('shim', ['exec', '-c', 'web_search="live"', '-']);
  assert.equal(shim.windowsVerbatimArguments, true);
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(
    shim.args[3],
    '""' + join(bin, 'shim.cmd') + '" "exec" "-c" "web_search=\\"live\\"" "-""',
  );
  assert.equal(plan('only.bat').resolved, join(bin, 'only.bat'));
  assert.equal(
    plan('shim.cmd').resolved,
    join(bin, 'shim.cmd'),
    'a name with an extension is found',
  );
  assert.deepEqual(plan('missing', ['a']), {
    command: 'missing',
    args: ['a'],
    windowsVerbatimArguments: false,
    resolved: null,
  });
  assert.equal(plan('C:/x/y.exe').command, 'C:/x/y.exe', 'a path is used as given');
  assert.equal(plan('C:/x/y.cmd').windowsVerbatimArguments, true, 'a .cmd path gets a shell plan');
  assert.deepEqual(
    resolveCommand('shim', ['a'], { platform: 'linux', env: fakeEnv }),
    { command: 'shim', args: ['a'], windowsVerbatimArguments: false, resolved: null },
    'other platforms are unchanged',
  );
  assert.equal(quoteCmdArgument('a b'), '"a b"');
  assert.equal(quoteCmdArgument('say "hi"'), '"say \\"hi\\""');
  const BS = String.fromCharCode(92);
  assert.equal(quoteCmdArgument('dir' + BS), '"dir' + BS + BS + '"');
  assert.equal(
    quoteCmdArgument('a' + BS + BS + '"b'),
    '"a' + BS.repeat(5) + '"b"',
    'backslashes before a quote are doubled and the quote is escaped',
  );
  for (const bad of ['a\nb', 'a\rb', 'a%PATH%', 'a&b', 'a|b', 'a<b', 'a>b', 'a^b', 'a\0b'])
    assert.throws(() => quoteCmdArgument(bad), /Command argument/, JSON.stringify(bad));
  if (process.platform === 'win32') {
    // A real .cmd shim started through processRun receives every argument intact.
    const dump = join(test, 'dump.mjs');
    writeFileSync(dump, 'console.log(JSON.stringify(process.argv.slice(2)))');
    writeFileSync(
      join(bin, 'echoargs.cmd'),
      '@echo off\r\n"' + process.execPath + '" "' + dump + '" %*\r\n',
    );
    const shimEnv = { ...process.env };
    const inherited = process.env.Path || process.env.PATH || '';
    for (const key of Object.keys(shimEnv)) if (/^path$/i.test(key)) delete shimEnv[key];
    shimEnv.Path = bin + ';' + inherited;
    const args = ['exec', '-c', 'web_search="live"', '--model', 'gpt-6.1-sol', 'two words', '-'];
    const run = await processRun('echoargs', args, {
      cwd: test,
      env: shimEnv,
      timeout: 15000,
    });
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), args);
  }
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
