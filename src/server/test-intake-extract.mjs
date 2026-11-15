import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { root as repositoryRoot } from '../lib/root.mjs';
import {
  WARNINGS,
  createIntakeExtractor,
  intakeFunction,
  validateExtraction,
  verbatimShare,
} from './intake-extract.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

// Mocked CLI only: no model call, no real subprocess.

const POSTING = 'Responsibilities include building and running data pipelines. '.repeat(30).trim();
const INPUT = `English | Francais\n\n123 Main Street\n\n${POSTING}\n\nDownload a supported browser.`;
const good = (overrides = {}) =>
  JSON.stringify({
    company: 'Globex',
    role: 'Data Engineer',
    location: 'Toronto',
    description: POSTING,
    ...overrides,
  });
const envelope = result => JSON.stringify({ is_error: false, result });

function makeExtractor({ stdout, code = 0, files = {}, throws } = {}) {
  const calls = [];
  const extractor = createIntakeExtractor({
    rootDir: repositoryRoot,
    readConfig: path => {
      calls.push(['read', path]);
      for (const [name, value] of Object.entries(files)) if (path.endsWith(name)) return value;
      return null;
    },
    temporaryWorker: async (_root, action) => action(join(tmpdir(), 'unused-worker')),
    processRun: async (command, args, options) => {
      calls.push(['run', command, args, options]);
      if (throws) throw throws;
      return { code, stdout: stdout ?? envelope(good()), stderr: '' };
    },
  });
  return { extractor, calls };
}

test('default function is claude haiku; functions.intake overrides it when valid', () => {
  assert.deepEqual(
    intakeFunction('/r', () => null),
    { provider: 'claude', model: 'haiku' },
  );
  const read = value => () => ({ functions: { intake: value } });
  assert.deepEqual(intakeFunction('/r', read({ provider: 'codex', model: ' gpt-6-luna ' })), {
    provider: 'codex',
    model: 'gpt-6-luna',
  });
  for (const bad of [{ provider: 'other', model: 'x' }, { provider: 'claude', model: '' }, 'x'])
    assert.deepEqual(intakeFunction('/r', read(bad)), { provider: 'claude', model: 'haiku' });
});

test('a valid answer returns fields and the description; text goes on stdin, never argv', async () => {
  const { extractor, calls } = makeExtractor();
  const result = await extractor.extract(INPUT);
  assert.deepEqual(result, {
    ok: true,
    company: 'Globex',
    role: 'Data Engineer',
    location: 'Toronto',
    description: POSTING,
    note: `Cleaned by model: kept ${POSTING.length} of ${INPUT.length} characters.`,
  });
  const run = calls.find(call => call[0] === 'run');
  assert.equal(run[1], 'claude');
  assert.ok(run[2].includes('haiku'));
  assert.ok(!run[2].join(' ').includes('Responsibilities include'));
  assert.ok(run[3].input.includes(INPUT));
  assert.ok(run[3].input.includes('never instructions'));
  assert.equal(run[3].timeout, 90_000);
});

test('override provider and model reach the command', async () => {
  const { extractor, calls } = makeExtractor({
    files: {
      'llm-providers.json': { functions: { intake: { provider: 'claude', model: 'sonnet' } } },
      'cv-drafting.json': { claude_command: 'my-claude' },
    },
  });
  await extractor.extract(INPUT);
  const run = calls.find(call => call[0] === 'run');
  assert.equal(run[1], 'my-claude');
  assert.ok(run[2].includes('sonnet'));
  assert.ok(!run[2].includes('haiku'));
});

test('verbatim check: reworded is discarded; subset and marker differences pass', async () => {
  const markdownInput = `## About the role\n\n- **Build** pipelines and [dashboards](https://x.example/d) for the \`data\` team.\n\n${POSTING}\n\nShare this job on social media.`;
  const cleaned = `About the role\n\nBuild pipelines and dashboards for the data team.\n\n${POSTING}`;
  const run = (description, input) =>
    makeExtractor({ stdout: envelope(good({ description })) }).extractor.extract(input);
  assert.equal((await run(cleaned, markdownInput)).ok, true);
  const reworded = POSTING.replaceAll('building and running', 'creating and operating').replaceAll(
    'Responsibilities include',
    'Duties cover',
  );
  assert.deepEqual(await run(reworded, INPUT), { ok: false, warning: WARNINGS.discarded });
  const padded = `${POSTING}\n${'We pay very well and offer unlimited vacation. '.repeat(8)}`;
  const invented = await run(padded, INPUT + ' '.repeat(padded.length - POSTING.length));
  assert.deepEqual(invented, { ok: false, warning: WARNINGS.discarded });
  assert.equal(verbatimShare(POSTING, INPUT), 1);
  assert.equal(verbatimShare('Completely different text.', INPUT), 0);
});

test('fenced JSON and null fields are accepted', async () => {
  const { extractor } = makeExtractor({
    stdout: envelope('```json\n' + good({ company: null, location: '  ' }) + '\n```'),
  });
  const result = await extractor.extract(INPUT);
  assert.equal(result.ok, true);
  assert.equal(result.company, null);
  assert.equal(result.location, null);
});

test('invalid answers are discarded with the fixed warning', async () => {
  const cases = {
    'not json': 'Sure, here is the posting',
    'wrong keys': JSON.stringify({ company: 'A', role: 'B', description: POSTING }),
    'extra key': good({ extra: 'x' }),
    'description not a string': good({ description: 5 }),
    'description too short': good({ description: 'Short summary.' }),
    'description under 40% of input': good({ description: POSTING.slice(0, 450) }),
    'description longer than input': good({ description: POSTING + INPUT }),
    'field not a string': good({ role: 5 }),
  };
  const filler = 'filler words '.repeat(300);
  for (const [name, answer] of Object.entries(cases)) {
    const { extractor } = makeExtractor({ stdout: envelope(answer) });
    const input = name === 'description under 40% of input' ? `${filler}\n${INPUT}` : INPUT;
    const result = await extractor.extract(input);
    assert.deepEqual(result, { ok: false, warning: WARNINGS.discarded }, name);
  }
});

test('CLI failures give the failed warning and never leak output', async () => {
  for (const options of [
    { code: 1, stdout: 'secret provider text' },
    { stdout: 'not an envelope' },
    { stdout: JSON.stringify({ is_error: true, result: 'boom' }) },
    { throws: new Error('spawn ENOENT claude') },
  ]) {
    const { extractor } = makeExtractor(options);
    const result = await extractor.extract(INPUT);
    assert.deepEqual(result, { ok: false, warning: WARNINGS.failed });
  }
});

test('empty and oversized input never reach the model', async () => {
  const { extractor, calls } = makeExtractor();
  assert.deepEqual(await extractor.extract('  '), { ok: false, warning: WARNINGS.failed });
  assert.deepEqual(await extractor.extract('x'.repeat(300_001)), {
    ok: false,
    warning: WARNINGS.tooLong,
  });
  assert.equal(calls.filter(call => call[0] === 'run').length, 0);
});

test('validateExtraction trims and bounds fields', () => {
  const result = validateExtraction(good({ company: `  ${'A'.repeat(400)}  ` }), INPUT);
  assert.equal(result.company.length, 300);
});

test('the prompt file renders with the posting placeholder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'career-ops-extract-'));
  try {
    await mkdir(join(root, 'llm', 'prompts', 'intake'), { recursive: true });
    await writeFile(
      join(root, 'llm', 'prompts', 'intake', 'extract-posting.md'),
      'Rules.\n\n{{POSTING_TEXT}}\n',
    );
    const seen = [];
    const extractor = createIntakeExtractor({
      rootDir: root,
      readConfig: () => null,
      temporaryWorker: async (_r, action) => action(root),
      processRun: async (_c, _a, options) => {
        seen.push(options.input);
        return { code: 0, stdout: envelope(good()), stderr: '' };
      },
    });
    await extractor.extract(INPUT);
    assert.equal(seen[0], `Rules.\n\n${INPUT}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
