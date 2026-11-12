import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as realFs from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyLoginFailure,
  createProvidersService,
  deriveLegacy,
  DEFAULT_MODELS,
  FUNCTIONS,
  validModel,
} from './providers.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');

async function withRoot(callback, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'career-ops-providers-'));
  try {
    await mkdir(join(root, 'config'), { recursive: true });
    for (const [name, content] of Object.entries(files))
      await writeFile(
        join(root, 'config', name),
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

async function rejects(promise, statusCode, code, field) {
  await assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode, error.message);
    assert.equal(error.publicCode, code);
    if (field) assert.deepEqual(Object.keys(error.fields), [field]);
    return true;
  });
}

const settingsPath = root => join(root, 'config', 'llm-providers.json');
const listing = root => readdir(join(root, 'config')).then(names => names.sort());

test('legacy derivation: launcher defaults, configured values and ignored garbage', () => {
  const defaults = deriveLegacy({ evaluationConfig: {}, cvConfig: {} });
  assert.deepEqual(defaults, {
    evaluation: { provider: 'claude', model: 'sonnet' },
    companyResearch: { provider: 'claude', model: 'haiku' },
    cv: { provider: 'claude', model: 'sonnet' },
    coverLetter: { provider: 'claude', model: 'sonnet' },
  });
  const codex = deriveLegacy({
    evaluationConfig: {
      default_provider: 'codex',
      codex_model: 'gpt-x',
      codex_research_model: 'gpt-r',
    },
    cvConfig: { default_provider: 'codex', codex_model: '' },
  });
  assert.deepEqual(codex.evaluation, { provider: 'codex', model: 'gpt-x' });
  assert.deepEqual(codex.companyResearch, { provider: 'codex', model: 'gpt-r' });
  assert.deepEqual(
    codex.cv,
    { provider: 'codex', model: 'gpt-6.1-sol' },
    'an empty codex_model falls back so a row is never empty',
  );
  const mixed = deriveLegacy({
    evaluationConfig: {
      default_provider: 'claude',
      claude_model: 'opus',
      claude_research_model: 'haiku-2',
    },
    cvConfig: { default_provider: 'codex', codex_model: 'gpt-9' },
  });
  assert.deepEqual(
    [mixed.evaluation.model, mixed.companyResearch.model, mixed.cv, mixed.coverLetter],
    [
      'opus',
      'haiku-2',
      { provider: 'codex', model: 'gpt-9' },
      { provider: 'codex', model: 'gpt-9' },
    ],
  );
  const garbage = deriveLegacy({
    evaluationConfig: { default_provider: 'gemini', claude_model: 5 },
    cvConfig: [],
  });
  assert.deepEqual(garbage, defaults);
  assert.equal(
    deriveLegacy({ evaluationConfig: null, cvConfig: 'x' }).evaluation.provider,
    'claude',
  );
});

test('get without a settings file is read-only legacy and writes nothing', async () => {
  await withRoot(
    async root => {
      const before = await listing(root);
      const service = createProvidersService({ rootDir: root });
      const doc = await service.get();
      assert.equal(doc.revision, 'legacy');
      assert.deepEqual(Object.keys(doc.functions), FUNCTIONS);
      assert.ok(Object.values(doc.functions).every(entry => entry.source === 'legacy'));
      assert.deepEqual(doc.functions.cv, {
        provider: 'codex',
        model: 'gpt-6.1-sol',
        source: 'legacy',
      });
      assert.deepEqual(doc.readiness, {
        claude: { state: 'unknown', checkedAt: null, message: null },
        codex: { state: 'unknown', checkedAt: null, message: null },
      });
      await service.get();
      assert.deepEqual(await listing(root), before, 'reading never creates or alters a file');
    },
    {
      'cv-drafting.json': { default_provider: 'codex', codex_model: '' },
      'evaluation-cli.json': { claude_model: 'opus' },
    },
  );
  // Missing, broken and non-object launcher configs all fall back to defaults.
  await withRoot(
    async root => {
      const doc = await createProvidersService({ rootDir: root }).get();
      assert.equal(doc.functions.evaluation.model, 'sonnet');
    },
    { 'evaluation-cli.json': '{ not json', 'cv-drafting.json': '[]' },
  );
  const bare = await mkdtemp(join(tmpdir(), 'career-ops-providers-bare-'));
  try {
    assert.equal(
      (await createProvidersService({ rootDir: bare }).get()).revision,
      'legacy',
      'no config folder at all',
    );
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
});

const body = (overrides = {}) => ({
  expectedRevision: 'legacy',
  provider: 'codex',
  model: 'gpt-5.5',
  ...overrides,
});

test('put validation matrix', async () => {
  await withRoot(async root => {
    const service = createProvidersService({ rootDir: root });
    for (const name of ['', 'evaluate', 'EVALUATION', 'cv ', '../x', undefined, 5])
      await rejects(service.put(name, body()), 400, 'INVALID_REQUEST', 'function');
    await rejects(service.put('cv', null), 400, 'INVALID_REQUEST', 'body');
    await rejects(service.put('cv', []), 400, 'INVALID_REQUEST', 'body');
    await rejects(service.put('cv', body({ extra: 1 })), 400, 'INVALID_REQUEST', 'extra');
    for (const expectedRevision of [
      '',
      'LEGACY',
      'abc',
      'g'.repeat(64),
      'a'.repeat(63),
      5,
      null,
      undefined,
    ])
      await rejects(
        service.put('cv', body({ expectedRevision })),
        400,
        'INVALID_REQUEST',
        'expectedRevision',
      );
    for (const provider of ['openai', 'Claude', '', 5, null, undefined])
      await rejects(service.put('cv', body({ provider })), 400, 'INVALID_REQUEST', 'provider');
    for (const model of [
      '',
      '   ',
      'x'.repeat(81),
      'bad\u0000model',
      'new\nline',
      5,
      null,
      undefined,
    ])
      await rejects(service.put('cv', body({ model })), 400, 'INVALID_REQUEST', 'model');
    assert.deepEqual(await listing(root), [], 'a rejected request writes nothing');
    assert.equal(validModel('x'.repeat(80)), true);
    assert.equal(validModel('gpt-5.5'), true);
    assert.equal(validModel(' padded '), true);
  });
});

test('the first save materializes all four functions atomically and later saves rewrite the file', async () => {
  await withRoot(
    async root => {
      const service = createProvidersService({ rootDir: root });
      const first = await service.put(
        'coverLetter',
        body({ provider: 'codex', model: ' gpt-5.5 ' }),
      );
      const text = await readFile(settingsPath(root), 'utf8');
      assert.deepEqual(JSON.parse(text), {
        version: 1,
        functions: {
          evaluation: { provider: 'claude', model: 'opus' },
          companyResearch: { provider: 'claude', model: 'haiku' },
          cv: { provider: 'claude', model: 'sonnet' },
          coverLetter: { provider: 'codex', model: 'gpt-5.5' },
        },
      });
      assert.ok(text.endsWith('\n'));
      assert.equal(first.revision, sha(text));
      assert.ok(Object.values(first.functions).every(entry => entry.source === 'file'));
      assert.deepEqual(first.functions.coverLetter, {
        provider: 'codex',
        model: 'gpt-5.5',
        source: 'file',
      });
      assert.deepEqual(
        await listing(root),
        ['evaluation-cli.json', 'llm-providers.json'],
        'no temporary file is left',
      );
      // The launcher configs are never modified.
      assert.equal(
        await readFile(join(root, 'config', 'evaluation-cli.json'), 'utf8'),
        '{"claude_model":"opus"}',
      );
      assert.deepEqual((await service.get()).functions, first.functions);
      const second = await service.put(
        'evaluation',
        body({ expectedRevision: first.revision, provider: 'claude', model: 'sonnet-4' }),
      );
      assert.notEqual(second.revision, first.revision);
      assert.equal(second.functions.evaluation.model, 'sonnet-4');
      assert.equal(
        second.functions.coverLetter.model,
        'gpt-5.5',
        'other functions keep their values',
      );
      assert.equal(second.revision, sha(await readFile(settingsPath(root), 'utf8')));
      // Saving the same values again still works and keeps the revision stable.
      const same = await service.put(
        'evaluation',
        body({ expectedRevision: second.revision, provider: 'claude', model: 'sonnet-4' }),
      );
      assert.equal(same.revision, second.revision);
    },
    { 'evaluation-cli.json': '{"claude_model":"opus"}' },
  );
});

test('stale revisions are 409 SETTINGS_CONFLICT with the current document; the file is unchanged', async () => {
  await withRoot(async root => {
    const service = createProvidersService({ rootDir: root });
    const first = await service.put('cv', body({ provider: 'claude', model: 'sonnet' }));
    const before = await readFile(settingsPath(root), 'utf8');
    for (const expectedRevision of ['legacy', 'a'.repeat(64)])
      await assert.rejects(service.put('cv', body({ expectedRevision, model: 'other' })), error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'SETTINGS_CONFLICT');
        assert.equal(error.current.revision, first.revision);
        assert.deepEqual(error.current.functions, first.functions);
        assert.deepEqual(Object.keys(error.current), [
          'functions',
          'revision',
          'readiness',
          'models',
        ]);
        return true;
      });
    assert.equal(await readFile(settingsPath(root), 'utf8'), before);
    // A change made behind the service's back is detected by the file hash.
    await writeFile(settingsPath(root), before.replace('sonnet', 'edited'));
    await rejects(
      service.put('cv', body({ expectedRevision: first.revision })),
      409,
      'SETTINGS_CONFLICT',
    );
  });
});

test('two saves from the same revision: one wins, the other conflicts', async () => {
  await withRoot(async root => {
    const service = createProvidersService({ rootDir: root });
    const results = await Promise.allSettled([
      service.put('cv', body({ provider: 'claude', model: 'one' })),
      service.put('coverLetter', body({ provider: 'claude', model: 'two' })),
      service.put('evaluation', body({ provider: 'claude', model: 'three' })),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    for (const failed of results.filter(r => r.status === 'rejected'))
      assert.equal(failed.reason.publicCode, 'SETTINGS_CONFLICT');
    const doc = await service.get();
    assert.equal(doc.revision, sha(await readFile(settingsPath(root), 'utf8')));
    assert.deepEqual(await listing(root), ['llm-providers.json']);
  });
});

test('a failed write is a safe error, leaves no temporary file and keeps the old file', async () => {
  await withRoot(async root => {
    const ok = createProvidersService({ rootDir: root });
    const first = await ok.put('cv', body({ provider: 'claude', model: 'sonnet' }));
    const before = await readFile(settingsPath(root), 'utf8');
    const failing = createProvidersService({
      rootDir: root,
      fs: {
        ...realFs,
        rename: async () => {
          throw new Error('EPERM secret-os-text');
        },
      },
    });
    await assert.rejects(
      failing.put('cv', body({ expectedRevision: first.revision, model: 'new' })),
      error => {
        assert.equal(error.statusCode, 500);
        assert.equal(error.publicCode, 'SETTINGS_WRITE_FAILED');
        assert.equal(JSON.stringify(error).includes('secret-os-text'), false);
        return true;
      },
    );
    assert.equal(await readFile(settingsPath(root), 'utf8'), before);
    assert.deepEqual(await listing(root), ['llm-providers.json']);
  });
});

test('an unreadable or malformed settings file is SETTINGS_UNREADABLE and never echoed', async () => {
  const bad = [
    '{ not json',
    '[]',
    '{"version":2,"functions":{}}',
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, functions: { evaluation: { provider: 'claude', model: 'x' } } }),
    JSON.stringify({
      version: 1,
      functions: Object.fromEntries(
        FUNCTIONS.map(name => [name, { provider: 'gemini', model: 'x' }]),
      ),
    }),
    JSON.stringify({
      version: 1,
      functions: Object.fromEntries(
        FUNCTIONS.map(name => [name, { provider: 'claude', model: '' }]),
      ),
    }),
    'x'.repeat(70 * 1024),
  ];
  for (const text of bad)
    await withRoot(
      async root => {
        const service = createProvidersService({ rootDir: root });
        for (const call of [
          () => service.get(),
          () => service.put('cv', body()),
          () => service.resolve('cv'),
        ])
          await assert.rejects(call(), error => {
            assert.equal(error.statusCode, 503);
            assert.equal(error.publicCode, 'SETTINGS_UNREADABLE');
            assert.equal(error.message.includes('x'.repeat(10)), false);
            return true;
          });
        assert.equal(
          await readFile(settingsPath(root), 'utf8'),
          text,
          'the broken file is left alone',
        );
      },
      { 'llm-providers.json': text },
    );
});

test('readiness: ready, not logged in, unavailable, timeout; never a model call', async () => {
  await withRoot(
    async root => {
      const calls = [];
      const outcomes = {
        claude: () => ({ provider: 'claude', subscription_login: true }),
        codex: () => {
          throw new Error('ChatGPT login required. Run codex login; API billing is not used.');
        },
      };
      const service = createProvidersService({
        rootDir: root,
        now: () => new Date('2026-11-10T12:00:00Z'),
        temporaryWorker: async (workRoot, action) => {
          assert.equal(workRoot, root);
          return action('/synthetic/work');
        },
        checkLogin: async (provider, config, cwd) => {
          calls.push([provider, config, cwd]);
          return outcomes[provider]();
        },
      });
      assert.equal((await service.get()).readiness.claude.state, 'unknown');
      const result = await service.checkReadiness();
      assert.deepEqual(result.readiness.claude, {
        state: 'ready',
        checkedAt: '2026-11-10T12:00:00.000Z',
        message: null,
      });
      assert.deepEqual(result.readiness.codex, {
        state: 'notLoggedIn',
        checkedAt: '2026-11-10T12:00:00.000Z',
        message: 'ChatGPT login required. Run codex login; API billing is not used.',
      });
      assert.deepEqual(calls.map(call => call[0]).sort(), ['claude', 'codex']);
      assert.deepEqual(
        calls[0][1],
        { claude_command: 'my-claude', codex_command: 'my-codex' },
        'commands come from cv-drafting.json',
      );
      assert.equal(calls[0][2], '/synthetic/work');
      assert.deepEqual(
        (await service.get()).readiness,
        result.readiness,
        'the last result is held in memory',
      );

      outcomes.claude = () => {
        throw new Error('Cannot read Claude login status. Run claude auth login.');
      };
      outcomes.codex = () => {
        throw Object.assign(new Error('spawn codex ENOENT /private/path secret-token'), {
          code: 'ENOENT',
        });
      };
      const second = await service.checkReadiness();
      assert.equal(second.readiness.claude.state, 'notLoggedIn');
      assert.match(second.readiness.claude.message, /claude auth login/);
      assert.equal(second.readiness.codex.state, 'unavailable');
      assert.equal(
        second.readiness.codex.message,
        'The codex command could not be run. Check that it is installed.',
      );
      assert.equal(JSON.stringify(second).includes('secret-token'), false);
      assert.equal(JSON.stringify(second).includes('/private'), false);
    },
    { 'cv-drafting.json': { claude_command: 'my-claude', codex_command: 'my-codex' } },
  );
});

test('readiness is bounded and concurrent requests share one check', async () => {
  await withRoot(async root => {
    let running = 0;
    let started = 0;
    const slow = createProvidersService({
      rootDir: root,
      checkTimeoutMs: 80,
      temporaryWorker: async (_root, action) => action('/w'),
      checkLogin: async provider => {
        started++;
        if (provider === 'codex') await new Promise(() => {});
        return { provider };
      },
    });
    const began = Date.now();
    const [a, b] = await Promise.all([slow.checkReadiness(), slow.checkReadiness()]);
    assert.ok(Date.now() - began < 3000, 'a hung login check is cut off');
    assert.equal(started, 2, 'two concurrent requests ran one check per provider');
    assert.deepEqual(a, b);
    assert.equal(a.readiness.claude.state, 'ready');
    assert.deepEqual(
      [a.readiness.codex.state, a.readiness.codex.message],
      ['unavailable', 'The login check took too long. Try again.'],
    );
    assert.equal(running, 0);
    await slow.checkReadiness();
    assert.equal(started, 4, 'a later request checks again');
  });
});

test('classifyLoginFailure keeps only the fixed login messages', () => {
  assert.equal(
    classifyLoginFailure(
      new Error(
        'Claude subscription login required. Run claude auth login; API billing is not used.',
      ),
    ).state,
    'notLoggedIn',
  );
  assert.equal(
    classifyLoginFailure(
      new Error('ChatGPT login required. Run codex login; API billing is not used.'),
    ).state,
    'notLoggedIn',
  );
  assert.deepEqual(classifyLoginFailure(new Error('ENOENT')), {
    state: 'unavailable',
    message: null,
  });
  assert.deepEqual(classifyLoginFailure(null), { state: 'unavailable', message: null });
});

test('resolve gives the effective selection per action and nothing for other actions', async () => {
  await withRoot(async root => {
    const service = createProvidersService({ rootDir: root });
    assert.deepEqual(await service.resolve('evaluate'), {
      evaluation: { provider: 'claude', model: 'sonnet' },
      companyResearch: { provider: 'claude', model: 'haiku' },
    });
    assert.deepEqual(await service.resolve('cv'), { cv: { provider: 'claude', model: 'sonnet' } });
    assert.deepEqual(await service.resolve('letter'), {
      coverLetter: { provider: 'claude', model: 'sonnet' },
    });
    assert.deepEqual(await service.resolve('scan'), {});
    await service.put('companyResearch', body({ provider: 'codex', model: 'gpt-r' }));
    assert.deepEqual((await service.resolve('evaluate')).companyResearch, {
      provider: 'codex',
      model: 'gpt-r',
    });
  });
});

test('factory rejects non-function adapters', () => {
  assert.throws(() => createProvidersService({ checkLogin: 'no' }), TypeError);
  assert.throws(() => createProvidersService({ temporaryWorker: null }), TypeError);
  assert.throws(() => createProvidersService({ now: 5 }), TypeError);
});

test('a leading UTF-8 byte-order mark is stripped before parsing; real garbage stays unreadable', async () => {
  const document = JSON.stringify({
    version: 1,
    functions: Object.fromEntries(
      FUNCTIONS.map(name => [name, { provider: 'codex', model: 'gpt-bom' }]),
    ),
  });
  await withRoot(
    async root => {
      const service = createProvidersService({ rootDir: root });
      const read = await service.get();
      for (const name of FUNCTIONS) {
        assert.equal(read.functions[name].model, 'gpt-bom');
        assert.equal(read.functions[name].source, 'file');
      }
      assert.equal(read.revision, sha('﻿' + document), 'the revision is of the raw bytes');
      assert.deepEqual(await service.resolve('cv'), {
        cv: { provider: 'codex', model: 'gpt-bom' },
      });
    },
    { 'llm-providers.json': '﻿' + document },
  );
  // A BOM in front of a file that still does not parse keeps SETTINGS_UNREADABLE.
  await withRoot(
    async root => {
      const service = createProvidersService({ rootDir: root });
      await rejects(service.get(), 503, 'SETTINGS_UNREADABLE');
    },
    { 'llm-providers.json': '﻿{ not json' },
  );
});

test('D066 models: defaults, valid override, invalid override ignored, configured model kept', async () => {
  const defaults = {
    claude: ['sonnet', 'opus', 'haiku'],
    codex: ['gpt-6.1-sol', 'gpt-6-luna'],
  };
  assert.deepEqual(DEFAULT_MODELS, defaults);
  await withRoot(async root => {
    assert.deepEqual((await createProvidersService({ rootDir: root }).get()).models, defaults);
  });
  const functions = Object.fromEntries(
    FUNCTIONS.map(name => [name, { provider: 'claude', model: 'unlisted-model' }]),
  );
  const file = models => JSON.stringify({ version: 1, models, functions });
  await withRoot(
    async root => {
      const service = createProvidersService({ rootDir: root });
      const got = await service.get();
      assert.deepEqual(got.models, { claude: ['a', 'b'], codex: DEFAULT_MODELS.codex });
      assert.equal(
        got.functions.cv.model,
        'unlisted-model',
        'a configured model outside the list is kept',
      );
      // Saving keeps the override in the file.
      await service.put('cv', body({ expectedRevision: got.revision, model: 'a' }));
      assert.deepEqual(JSON.parse(await readFile(settingsPath(root), 'utf8')).models, {
        claude: ['a', 'b'],
        codex: 'bad',
      });
    },
    { 'llm-providers.json': file({ claude: ['a', 'b'], codex: 'bad' }) },
  );
  for (const bad of [
    { claude: [], codex: [] },
    { claude: ['ok', ''], codex: [1] },
    { claude: Array.from({ length: 51 }, (_, i) => 'm' + i) },
    { claude: ['x'.repeat(81)] },
    'nope',
    null,
  ])
    await withRoot(
      async root => {
        assert.deepEqual((await createProvidersService({ rootDir: root }).get()).models, defaults);
      },
      { 'llm-providers.json': file(bad) },
    );
});

test('an optional functions.intake entry is accepted, hidden from the document and kept on save', async () => {
  const functions = Object.fromEntries(
    FUNCTIONS.map(name => [name, { provider: 'claude', model: 'sonnet' }]),
  );
  const intake = { provider: 'codex', model: 'gpt-6-luna' };
  await withRoot(
    async root => {
      const service = createProvidersService({ rootDir: root });
      const got = await service.get();
      assert.deepEqual(Object.keys(got.functions), FUNCTIONS);
      await service.put('cv', body({ expectedRevision: got.revision, provider: 'claude' }));
      assert.deepEqual(
        JSON.parse(await readFile(settingsPath(root), 'utf8')).functions.intake,
        intake,
      );
    },
    { 'llm-providers.json': JSON.stringify({ version: 1, functions: { ...functions, intake } }) },
  );
});
