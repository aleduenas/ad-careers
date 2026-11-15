import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { urlKey } from '../lib/_database.mjs';
import { createIntakeService, runLauncher } from './intake.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';
import { createDiscoveryLock } from './runs.mjs';

const ROOT = resolve(tmpdir(), 'career-ops-intake-root');
const TEXT = 'A real description line.   \r\n\tIndented, with trailing spaces   \n'.repeat(5);

function makeService({ rows = {}, execute, ...options } = {}) {
  const queries = [];
  const executed = [];
  const service = createIntakeService({
    rootDir: ROOT,
    query: async (sql, args) => {
      queries.push([sql, args]);
      if (/SELECT DISTINCT trim\(company\)/.test(sql)) return rows.companies ?? [];
      if (/FROM jobs WHERE url IS NOT NULL/.test(sql))
        return rows.tracked
          ? [{ url: 'https://example.invalid/jobs/1', ...rows.tracked }]
          : (rows.jobs ?? []);
      if (/FROM scan_history\s+WHERE/.test(sql)) return rows.seen ? [rows.seen] : [];
      if (/SELECT DISTINCT trim\(company\)/.test(sql)) return rows.companies ?? [];
      if (/SELECT jd_path/.test(sql)) return rows.jdPath ? [{ jd_path: rows.jdPath }] : [];
      throw new Error('unexpected SQL');
    },
    execute: async call => {
      executed.push(call);
      return execute ? execute(call) : { code: 0, stdout: '', stderr: '', timedOut: false };
    },
    ...options,
  });
  return { service, queries, executed };
}

const body = (overrides = {}) => ({
  url: 'https://example.invalid/jobs/1',
  company: 'Acme',
  role: 'Data Engineer',
  text: TEXT,
  ...overrides,
});

async function rejects(promise, statusCode, code, field) {
  await assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode, error.message);
    assert.equal(error.publicCode, code);
    if (field) assert.deepEqual(Object.keys(error.fields), [field]);
    return true;
  });
}

test('check: normalized URL, tracked job, seen sighting, neither, and unparseable input', async () => {
  const tracked = makeService({
    rows: { tracked: { id: '12', company: 'Acme', role: 'Eng', status: 'Applied' } },
  });
  const hit = await tracked.service.check({ url: ' <example.invalid/jobs/1/> ' });
  assert.deepEqual(hit, {
    url: 'https://example.invalid/jobs/1/',
    tracked: { id: '12', company: 'Acme', role: 'Eng', status: 'Applied' },
    seen: null,
  });
  assert.match(tracked.queries[0][0], /FROM jobs WHERE url IS NOT NULL/);
  assert.equal(tracked.queries.length, 1, 'a tracked job stops the lookup');

  const seen = makeService({
    rows: { seen: { company: 'Acme', title: 'Eng', status: 'added', first_seen: '2026-10-01' } },
  });
  assert.deepEqual(await seen.service.check({ url: 'https://example.invalid/jobs/2' }), {
    url: 'https://example.invalid/jobs/2',
    tracked: null,
    seen: { company: 'Acme', title: 'Eng', status: 'added', firstSeen: '2026-10-01' },
  });
  assert.match(seen.queries[1][0], /regexp_replace/);
  assert.deepEqual(await makeService().service.check({ url: 'https://example.invalid/jobs/3' }), {
    url: 'https://example.invalid/jobs/3',
    tracked: null,
    seen: null,
  });
  const bad = makeService();
  for (const url of ['ftp://x.example/a', 'javascript:alert(1)', 'https://bad host/x', 'https://'])
    assert.deepEqual(await bad.service.check({ url }), { url: null, tracked: null, seen: null });
  assert.equal(bad.queries.length, 0, 'an unparseable URL never reaches the database');
  for (const input of [
    {},
    { url: '' },
    { url: '   ' },
    { url: 5 },
    { url: 'x'.repeat(2049) },
    { url: 'https://a.example', x: 1 },
    null,
  ])
    await rejects(makeService().service.check(input), 400, 'INVALID_REQUEST');
});

test('companies: normalized prefix match, distinct, sorted, capped at 10', async () => {
  const names = [
    'TD Bank',
    'td bank',
    'T.D. Insurance',
    'Tdx Labs',
    'Acme',
    'Tangent',
    ...Array.from({ length: 14 }, (_, i) => `TDco ${String(i).padStart(2, '0')}`),
  ];
  const { service } = makeService({ rows: { companies: names.map(company => ({ company })) } });
  const result = await service.companies({ q: 'td' });
  assert.equal(result.companies.length, 10);
  assert.ok(
    result.companies.every(name =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .startsWith('td'),
    ),
  );
  assert.deepEqual(result.companies.slice(0, 3), ['T.D. Insurance', 'TD Bank', 'TDco 00']);
  assert.equal(
    result.companies.filter(name => name.toLowerCase() === 'td bank').length,
    1,
    'spellings differing only by case are one',
  );
  assert.deepEqual((await service.companies({ q: 'T.D' })).companies.slice(0, 2), [
    'T.D. Insurance',
    'TD Bank',
  ]);
  assert.deepEqual((await service.companies({ q: 'zzz' })).companies, []);
  assert.deepEqual((await service.companies({ q: '!!!' })).companies, []);
  for (const q of [undefined, '', '   ', 5, 'x'.repeat(101)])
    await rejects(service.companies({ q }), 400, 'INVALID_REQUEST', 'q');
});

test('preview runs the launcher dry-run by argv with the text byte for byte', async () => {
  const { service, executed } = makeService({
    execute: () => ({
      code: 0,
      stdout:
        JSON.stringify({
          mode: 'dry-run',
          company: 'Acme Corp',
          role: 'Data Engineer',
          url: 'https://example.invalid/jobs/1',
          jd_path: join(ROOT, 'data', 'jds', 'acme-corp', 'data-engineer.md'),
        }) + '\n',
      stderr: '',
      timedOut: false,
    }),
  });
  const result = await service.preview(body({ force: true }));
  assert.deepEqual(result, {
    company: 'Acme Corp',
    role: 'Data Engineer',
    url: 'https://example.invalid/jobs/1',
    jdPath: 'data/jds/acme-corp/data-engineer.md',
  });
  const call = executed[0];
  assert.equal(call.command, process.execPath);
  assert.deepEqual(call.args, [resolve(ROOT, 'src', 'scan', 'add-pasted-jd.mjs'), '--dry-run']);
  assert.equal(call.cwd, ROOT);
  const sent = JSON.parse(call.input);
  assert.equal(sent.text, TEXT, 'the pasted text is passed through unchanged');
  assert.deepEqual(Object.keys(sent).sort(), ['company', 'force', 'role', 'text', 'url']);
  assert.equal(sent.force, true);
  assert.ok(call.timeoutMs > 0 && call.timeoutMs <= 60000);
  assert.equal(call.shell, undefined, 'no shell');
  await service.preview(body());
  assert.equal(JSON.parse(executed[1].input).force, false, 'force defaults to false');
});

test('preview rejects bad bodies before running anything, and unparseable output is a generic failure', async () => {
  const { service, executed } = makeService();
  for (const [input, field] of [
    [body({ url: 5 }), 'url'],
    [body({ company: 5 }), 'company'],
    [body({ company: 'x'.repeat(301) }), 'company'],
    [body({ role: null }), 'role'],
    [body({ text: 5 }), 'text'],
    [body({ text: 'x'.repeat(2 * 1024 * 1024 + 1) }), 'text'],
    [body({ force: 'yes' }), 'force'],
    [body({ extra: 1 }), 'extra'],
  ])
    await rejects(service.preview(input), 400, 'INVALID_REQUEST', field);
  await rejects(service.preview(null), 400, 'INVALID_REQUEST', 'body');
  assert.equal(executed.length, 0);
  for (const stdout of [
    '',
    'not json',
    JSON.stringify({ mode: 'dry-run' }),
    JSON.stringify({
      mode: 'dry-run',
      company: 'A',
      role: 'R',
      url: 'u',
      jd_path: '/etc/outside.md',
    }),
  ]) {
    const odd = makeService({ execute: () => ({ code: 0, stdout, stderr: '', timedOut: false }) });
    await rejects(odd.service.preview(body()), 500, 'INTAKE_FAILED');
  }
});

test('the launcher failure messages map to public errors with the current state', async () => {
  const fail = stderr => ({ code: 1, stdout: '', stderr, timedOut: false });
  const cases = [
    ['Invalid or missing job URL\n', 400, 'INVALID_REQUEST', 'url'],
    ['Missing company name\n', 400, 'INVALID_REQUEST', 'company'],
    ['Missing role title\n', 400, 'INVALID_REQUEST', 'role'],
    [
      'Pasted JD text is too short — paste the full job description\n',
      400,
      'INVALID_REQUEST',
      'text',
    ],
  ];
  for (const [stderr, status, code, field] of cases) {
    const { service } = makeService({ execute: () => fail(stderr) });
    await rejects(service.preview(body()), status, code, field);
  }
  const duplicate = makeService({
    rows: { tracked: { id: '77', company: 'Acme', role: 'Eng', status: 'Interview' } },
    execute: () =>
      fail('This URL already belongs to a tracked job — skipping to avoid a duplicate\n'),
  });
  await assert.rejects(duplicate.service.preview(body({ force: true })), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.publicCode, 'DUPLICATE_JOB');
    assert.deepEqual(error.current, {
      tracked: { id: '77', company: 'Acme', role: 'Eng', status: 'Interview' },
    });
    return true;
  });
  const seen = makeService({
    rows: {
      seen: { company: 'Acme', title: 'Eng', status: 'skipped_title', first_seen: '2026-09-01' },
    },
    execute: () =>
      fail(
        'This URL was seen in a past scan but never tracked as a job — resubmit with force to continue\n',
      ),
  });
  await assert.rejects(seen.service.add(body()), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.publicCode, 'SEEN_URL');
    assert.equal(error.current.seen.firstSeen, '2026-09-01');
    return true;
  });
  const leak = makeService({
    execute: () =>
      fail('Error: password authentication failed for user "secret-user" at /private/path\n'),
  });
  await assert.rejects(leak.service.preview(body()), error => {
    assert.equal(error.statusCode, 500);
    assert.equal(error.publicCode, 'INTAKE_FAILED');
    assert.equal(JSON.stringify(error).includes('secret-user'), false);
    assert.equal(error.message.includes('/private'), false);
    return true;
  });
  const slow = makeService({
    execute: () => ({ code: null, stdout: '', stderr: '', timedOut: true }),
  });
  await rejects(slow.service.preview(body()), 503, 'INTAKE_TIMEOUT');
  const down = createIntakeService({
    rootDir: ROOT,
    query: async () => {
      throw new Error('secret-driver-text');
    },
    execute: () => fail('This URL already belongs to a tracked job\n'),
  });
  await assert.rejects(down.preview(body()), DatabaseUnavailableError);
  await assert.rejects(
    createIntakeService({
      query: async () => {
        throw Object.assign(new Error('x'), { code: '42P01' });
      },
    }).check({ url: 'https://example.invalid/a' }),
    SchemaNotReadyError,
  );
});

test('add parses the launcher line, keeps the role, and handles a company containing a dash separator', async () => {
  const success = line => ({ code: 0, stdout: line + '\n', stderr: '', timedOut: false });
  const path = join(ROOT, 'data', 'jds', 'acme', 'data-engineer.md');
  const plain = makeService({
    execute: () => success(`Added #42 — Acme Corp — Data Engineer (${path}; JD saved verbatim)`),
  });
  assert.deepEqual(await plain.service.add(body()), {
    id: '42',
    company: 'Acme Corp',
    role: 'Data Engineer',
    jdPath: 'data/jds/acme/data-engineer.md',
  });
  assert.deepEqual(
    plain.executed[0].args,
    [resolve(ROOT, 'src', 'scan', 'add-pasted-jd.mjs')],
    'no --dry-run for a real intake',
  );
  const dashed = makeService({
    execute: () => success(`Added #43 — Acme — Group — Data Engineer (${path}; JD saved verbatim)`),
  });
  assert.equal((await dashed.service.add(body())).company, 'Acme — Group');
  const padded = makeService({
    execute: () => success(`Added #44 — Acme — Data Engineer (${path}; JD saved verbatim)`),
  });
  assert.equal(
    (await padded.service.add(body({ role: '  Data Engineer  ' }))).role,
    'Data Engineer',
  );
  const odd = makeService({ execute: () => success('Added somewhere') });
  await rejects(odd.service.add(body()), 500, 'INTAKE_FAILED');
  const outside = makeService({
    execute: () => success('Added #45 — Acme — Data Engineer (/etc/passwd; JD saved verbatim)'),
  });
  await rejects(outside.service.add(body()), 500, 'INTAKE_FAILED');
});

test('add: an unexpected launcher line falls back to the job found by its normalized URL', async () => {
  const path = join(ROOT, 'data', 'jds', 'acme', 'data-engineer.md');
  const odd = { code: 0, stdout: 'Created job (see database)\n', stderr: '', timedOut: false };
  const found = makeService({
    execute: () => odd,
    rows: {
      tracked: { id: '88', company: 'Acme Corp', role: 'Data Engineer', status: 'Pending' },
      jdPath: path,
    },
  });
  assert.deepEqual(await found.service.add(body()), {
    id: '88',
    company: 'Acme Corp',
    role: 'Data Engineer',
    jdPath: 'data/jds/acme/data-engineer.md',
  });
  assert.match(
    found.queries[0][0],
    /FROM jobs WHERE url IS NOT NULL/,
    'the same lookup check uses',
  );
  const noPath = makeService({
    execute: () => odd,
    rows: { tracked: { id: '89', company: 'Acme', role: 'Eng', status: 'Pending' } },
  });
  assert.equal((await noPath.service.add(body())).jdPath, '');
  await rejects(makeService({ execute: () => odd }).service.add(body()), 500, 'INTAKE_FAILED');
  // The strict pattern stays the first attempt: a matching line never queries the database.
  const strict = makeService({
    execute: () => ({
      code: 0,
      stdout: `Added #7 — Acme — Data Engineer (${path}; JD saved verbatim)\n`,
      stderr: '',
      timedOut: false,
    }),
  });
  assert.equal((await strict.service.add(body())).id, '7');
  assert.equal(strict.queries.length, 0);
});

test('real intake is serialized with scans: a held lock or an active scan is DISCOVERY_BUSY and nothing runs', async () => {
  const lock = createDiscoveryLock();
  const { service, executed } = makeService({ discoveryLock: lock });
  const release = lock.tryAcquire('scan');
  await assert.rejects(service.add(body()), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.publicCode, 'DISCOVERY_BUSY');
    assert.deepEqual(error.current, { activeRunId: null });
    return true;
  });
  release();
  const id = '11111111-2222-4333-8444-555555555555';
  const busy = makeService({ discoveryLock: lock, activeScanRunId: async () => id });
  await assert.rejects(busy.service.add(body()), error => {
    assert.equal(error.publicCode, 'DISCOVERY_BUSY');
    assert.deepEqual(error.current, { activeRunId: id });
    return true;
  });
  assert.equal(executed.length + busy.executed.length, 0);
  assert.equal(lock.holder, null, 'the lock is released after a refusal');
  // A failing launcher releases the lock too, and a preview never takes it.
  const failing = makeService({
    discoveryLock: lock,
    execute: () => ({ code: 1, stdout: '', stderr: 'Missing role title', timedOut: false }),
  });
  await rejects(failing.service.add(body()), 400, 'INVALID_REQUEST', 'role');
  assert.equal(lock.holder, null);
  const hold = lock.tryAcquire('scan');
  const previewing = makeService({
    discoveryLock: lock,
    execute: () => ({ code: 1, stdout: '', stderr: 'Missing company name', timedOut: false }),
  });
  await rejects(previewing.service.preview(body()), 400, 'INVALID_REQUEST', 'company');
  hold();
});

test('the default executor is bounded: stdin, environment, output cap and timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'career-ops-exec-'));
  try {
    const echo = join(dir, 'echo.mjs');
    await writeFile(
      echo,
      "let t='';for await (const c of process.stdin) t+=c;console.log(JSON.stringify({argv:process.argv.slice(2),env:process.env.INTAKE_MARK,len:t.length,t}));",
    );
    const ok = await runLauncher({
      command: process.execPath,
      args: [echo, '--dry-run'],
      cwd: dir,
      input: 'héllo\r\nworld ',
      env: { ...process.env, INTAKE_MARK: 'yes' },
    });
    assert.equal(ok.code, 0);
    assert.deepEqual(JSON.parse(ok.stdout), {
      argv: ['--dry-run'],
      env: 'yes',
      len: 13,
      t: 'héllo\r\nworld ',
    });

    const loud = join(dir, 'loud.mjs');
    await writeFile(
      loud,
      "process.stdout.write('x'.repeat(500000));process.stderr.write('e'.repeat(500000));",
    );
    const capped = await runLauncher({
      command: process.execPath,
      args: [loud],
      cwd: dir,
      input: '',
      env: process.env,
    });
    assert.ok(capped.stdout.length <= 64 * 1024 && capped.stderr.length <= 64 * 1024);

    const hang = join(dir, 'hang.mjs');
    await writeFile(hang, 'setInterval(() => {}, 1000);');
    const started = Date.now();
    const slow = await runLauncher({
      command: process.execPath,
      args: [hang],
      cwd: dir,
      input: '',
      env: process.env,
      timeoutMs: 300,
    });
    assert.equal(slow.timedOut, true);
    assert.ok(Date.now() - started < 5000);

    const failed = await runLauncher({
      command: join(dir, 'missing-binary'),
      args: [],
      cwd: dir,
      input: '',
      env: process.env,
    });
    assert.ok(failed.failed || failed.code !== 0);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test('factory rejects non-function adapters', () => {
  assert.throws(() => createIntakeService({ query: 'no' }), TypeError);
  assert.throws(() => createIntakeService({ execute: null }), TypeError);
  assert.throws(() => createIntakeService({ activeScanRunId: 5 }), TypeError);
});

test('check: a job stored under an older key (tracking parameter, /en-US/) is found by the clean URL', async () => {
  const old = makeService({
    rows: {
      jobs: [
        {
          id: '5',
          company: 'Acme',
          role: 'Eng',
          status: 'Pending',
          url: 'https://x.example/jobs/9?utm_source=a#top',
          url_key: 'x.example/jobs/9?utm_source=a#top',
        },
      ],
    },
  });
  assert.equal((await old.service.check({ url: 'https://x.example/jobs/9' })).tracked?.id, '5');
  const wd = makeService({
    rows: {
      jobs: [
        {
          id: '6',
          company: 'W',
          role: 'E',
          status: 'Pending',
          url: 'https://t.wd3.myworkdayjobs.com/en-US/Site/job/a_JR1',
          url_key: 'stale',
        },
      ],
    },
  });
  assert.equal(
    (await wd.service.check({ url: 'https://t.wd3.myworkdayjobs.com/Site/job/a_JR1' })).tracked?.id,
    '6',
  );
  assert.equal(
    (await wd.service.check({ url: 'https://t.wd3.myworkdayjobs.com/Site/job/other' })).tracked,
    null,
  );
  assert.deepEqual(old.queries.find(q => /FROM scan_history/.test(q[0]))?.[1] ?? [[]], [[]]);
});

test('check: scan_history lookup matches the new key and the old-rule key', async () => {
  const s = makeService({});
  await s.service.check({ url: 'https://x.example/jobs/9?utm_source=a' });
  const args = s.queries.find(q => /FROM scan_history/.test(q[0]))[1];
  assert.deepEqual(args, [['x.example/jobs/9', 'x.example/jobs/9?utm_source=a']]);
});
