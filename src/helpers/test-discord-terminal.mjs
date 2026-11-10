import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/root.mjs';
import {
  SharedCodexRpc,
  terminalArguments,
  terminalEnvironment,
  validateRuntime,
  applyAutomaticReview,
  reloadMcpServers,
} from './discord-terminal.mjs';
import { developmentConfig } from './_discord-lead.mjs';

const runtime = { version: 1, endpoint: 'ws://127.0.0.1:4501', token: 'a'.repeat(64) };
const settingsCalls = [];
assert.equal(
  await applyAutomaticReview(
    {
      request: async (method, params) => {
        settingsCalls.push({ method, params });
        return method === 'thread/turns/list'
          ? { data: [{ id: 'active', status: 'inProgress' }] }
          : {};
      },
    },
    'lead',
  ),
  'active',
);
assert.deepEqual(
  settingsCalls.map(call => call.method),
  ['thread/settings/update', 'thread/turns/list', 'turn/settings/update'],
);
assert.equal(settingsCalls[0].params.approvalsReviewer, 'auto_review');
assert.equal(settingsCalls[2].params.approvalsReviewer, 'auto_review');
const reloadCalls = [];
assert.deepEqual(
  await reloadMcpServers({
    request: async (method, params) => {
      reloadCalls.push({ method, params });
      return {};
    },
  }),
  {},
);
assert.deepEqual(reloadCalls, [{ method: 'config/mcpServer/reload', params: null }]);
assert.equal(validateRuntime(runtime), runtime);
for (const endpoint of [
  'ws://example.com:4501',
  'ws://0.0.0.0:4501',
  'ws://127.0.0.1:4501/path',
  'ws://127.0.0.1:4501/?token=secret',
  'ws://user:password@127.0.0.1:4501',
  'http://127.0.0.1:4501',
  'ws://127.0.0.1:4501/#secret',
])
  assert.throws(() => validateRuntime({ ...runtime, endpoint }));
assert.throws(() => validateRuntime({ ...runtime, token: 'short' }));
assert.throws(() => validateRuntime({ ...runtime, version: 2 }));
const args = terminalArguments(runtime, 'test-thread-1');
assert(args.includes('resume') && args.includes('test-thread-1') && args.includes('--remote'));
assert(args.includes('--remote-auth-token-env'));
// The remote runtime owns permissions; CLI permission overrides reject remote resume.
for (const flag of [
  '--approve-for-me',
  '--sandbox',
  '--ask-for-approval',
  '--dangerously-bypass-approvals-and-sandbox',
])
  assert(!args.includes(flag));
assert.equal(developmentConfig().approvals_reviewer, 'auto_review');
assert.equal(developmentConfig().approval_policy, 'on-request');
assert(developmentConfig()['auto_review.extra_policy'].includes('explicit approval'));
assert(!args.join(' ').includes(runtime.token));
assert(!args.some(arg => /bypass|never/.test(arg)));
assert.throws(() => terminalArguments(runtime, '--last'));
assert.throws(() => terminalArguments(runtime, 'bad thread id'));
assert.deepEqual(
  terminalEnvironment(runtime, {
    PATH: 'local',
    DISCORD_LEAD_BOT_TOKEN: 'bot-secret',
    OPENAI_API_KEY: 'api-secret',
    ANTHROPIC_API_KEY: 'other-secret',
    CAREER_DISCORD_CODEX_COMMAND: 'codex.exe',
  }),
  {
    PATH: 'local',
    CAREER_DISCORD_CODEX_COMMAND: 'codex.exe',
    CAREER_LEAD_RUNTIME_TOKEN: runtime.token,
  },
);

const sent = [];
class Socket extends EventTarget {
  constructor(url, options) {
    super();
    assert.equal(url, runtime.endpoint);
    assert.equal(options.headers.Authorization, 'Bearer ' + runtime.token);
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(text) {
    const message = JSON.parse(text);
    sent.push(message);
    if (message.id && message.method !== 'never')
      queueMicrotask(() =>
        this.receive({
          id: message.id,
          ...(message.method === 'fail'
            ? { error: { code: -123, message: 'private raw detail' } }
            : {
                result: message.method === 'account/read' ? { account: { type: 'chatgpt' } } : {},
              }),
        }),
      );
  }
  receive(message) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  close() {
    this.dispatchEvent(new Event('close'));
  }
}
let observed;
const adapter = new SharedCodexRpc(runtime, {
  Socket,
  onEvent: message => {
    observed = message;
  },
});
assert.equal((await adapter.initialize()).account.type, 'chatgpt');
assert.deepEqual(
  sent.map(item => item.method),
  ['initialize', 'initialized', 'account/read'],
);
adapter.socket.receive({ method: 'turn/started', params: { turn: { id: 'active-turn' } } });
assert.equal(observed.method, 'turn/started');
const count = sent.length;
adapter.socket.receive({
  id: 999,
  method: 'mcpServer/elicitation/request',
  params: { threadId: 'test-thread' },
});
assert.equal(
  sent.length,
  count,
  'Shared adapter must not auto-deny or approve a native terminal request.',
);
await assert.rejects(adapter.request('fail'), /^Error: Codex RPC error \(-123\)\.$/);

// Disconnecting/replacing the Discord connection leaves another native client usable.
const terminal = new SharedCodexRpc(runtime, { Socket });
await terminal.initialize();
const pending = adapter.request('never');
await Promise.resolve();
adapter.close();
await assert.rejects(pending, /disconnected/);
assert.deepEqual(await terminal.request('thread/loaded/list'), {});
const replacement = new SharedCodexRpc(runtime, { Socket });
await replacement.initialize();
assert.deepEqual(await terminal.request('thread/read', { threadId: 'test-thread' }), {});
replacement.close();
terminal.close();

if (process.platform === 'win32') {
  const fixtures = join(root, 'logs/tests');
  mkdirSync(fixtures, { recursive: true });
  const fixtureRoot = mkdtempSync(join(fixtures, 'discord-acl-'));
  const aclCheck = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      String.raw`
    $ErrorActionPreference = 'Stop'
    $parseErrors = $null; $parseTokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:CAREER_ACL_LAUNCHER, [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Launcher syntax failed.' }
    $branch = $ast.Find({ param($node)
      $node -is [System.Management.Automation.Language.IfStatementAst] -and
      $node.Clauses[0].Item1.Extent.Text -eq '$Terminal'
    }, $true)
    if (-not $branch) { throw 'Runtime ACL setup was not found.' }
    $body = $branch.Clauses[0].Item2.Extent.Text
    $setup = [scriptblock]::Create($body.Substring(1, $body.Length - 2))
    $repoRoot = $env:CAREER_ACL_TEST_ROOT
    $directory = Join-Path $repoRoot 'logs\dev-discord-lead\runtime'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Group
    $before = [IO.Directory]::GetAccessControl($directory, $sections)
    $owner = $before.GetOwner([System.Security.Principal.SecurityIdentifier])
    $group = $before.GetGroup([System.Security.Principal.SecurityIdentifier])
    & $setup
    [IO.File]::WriteAllText((Join-Path $directory 'marker.txt'), 'preserved')
    & $setup
    $after = [IO.Directory]::GetAccessControl($directory, $sections)
    $rules = @($after.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    if (-not $after.AreAccessRulesProtected -or $rules.Count -ne 1 -or
        $rules[0].IdentityReference -ne $sid -or
        $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
        $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { throw 'Runtime ACL is not account-only FullControl.' }
    if ($after.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $owner -or
        $after.GetGroup([System.Security.Principal.SecurityIdentifier]) -ne $group) { throw 'ACL setup changed owner/group.' }
    if ([IO.File]::ReadAllText((Join-Path $directory 'marker.txt')) -ne 'preserved') { throw 'Repeat setup changed existing runtime state.' }
    Write-Output 'Windows runtime ACL regression passed (fresh/existing directory, owner/group and state preserved).'
  `,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        CAREER_ACL_LAUNCHER: join(root, 'src/helpers/Start-DiscordLead.ps1'),
        CAREER_ACL_TEST_ROOT: fixtureRoot,
      },
    },
  );
  assert.equal(aclCheck.status, 0, aclCheck.stdout + aclCheck.stderr);
  console.log(aclCheck.stdout.trim());
}
console.log(
  'Discord terminal checks passed: authenticated transport, native attachment, approvals and adapter lifecycle. No network or model turns.',
);
