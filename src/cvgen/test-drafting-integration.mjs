// Real intake/status/drafting/publishing processes and Chromium; synthetic model output.
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { root } from '../lib/root.mjs';
import { parseWorksheet } from './_cv-worksheet.mjs';
if (!process.env.TEST_DATABASE_URL) {
  console.log(
    'SKIPPED drafting integration: run node src/helpers/db-test.mjs with Chromium installed',
  );
  process.exit(0);
}
const url = new URL(process.env.TEST_DATABASE_URL);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(url.pathname))
  throw new Error('Refusing non-test database');
const base = join(root, 'logs/tests/drafting-integration');
mkdirSync(base, { recursive: true });
const fixture = mkdtempSync(join(base, 'run-')),
  schema = 'draft_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
await admin.query('CREATE SCHEMA ' + schema);
url.searchParams.set('options', '-c search_path=' + schema);
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const put = (p, s) => {
  mkdirSync(dirname(join(fixture, p)), { recursive: true });
  writeFileSync(join(fixture, p), s);
};
try {
  for (const f of readdirSync(join(root, 'infra/sql/migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort())
    await db.query(readFileSync(join(root, 'infra/sql/migrations', f), 'utf8'));
  cpSync(join(root, 'src'), join(fixture, 'src'), { recursive: true });
  cpSync(join(root, 'llm/prompts'), join(fixture, 'llm/prompts'), { recursive: true });
  const worksheet = parseWorksheet(
    readFileSync(join(root, 'llm/prompts/cvgen/cv-worksheet.md'), 'utf8'),
  );
  const roles = Object.keys(worksheet.experience),
    projects = Object.keys(worksheet.projects);
  const headings = roles.map((_, i) => 'Engineer ' + i + ' | Example ' + i + ' | 2020-2021');
  put(
    'config/cv.md',
    '## Professional Experience\n' +
      roles
        .map(
          (slot, i) =>
            '### ' +
            headings[i] +
            '\n<!-- slot: ' +
            slot +
            ' -->\nBuilt Python services with SQL and tests.\n',
        )
        .join('') +
      '## Projects\n' +
      projects
        .map(
          (slot, i) =>
            '### Project ' +
            i +
            ' | Example | 2022\n<!-- slot: ' +
            slot +
            ' -->\nBuilt and tested a Python service.\n',
        )
        .join('') +
      '## Education\n### Degree | Example University | 2020\n**CV description:** Computer science.\n',
  );
  put(
    'config/profile.yml',
    'candidate:\n  full_name: Test Candidate\n  email: test@example.test\n',
  );
  put(
    'config/cv-content-policy.json',
    JSON.stringify({ required_role_headings: headings.slice(0, 3) }),
  );
  put(
    'config/cv-drafting.json',
    JSON.stringify({
      default_provider: 'claude',
      claude_command: 'fixture-claude',
      claude_model: 'fixture',
      timeout_ms: 30000,
      drafting_root: 'logs/drafting',
    }),
  );
  put(
    'llm/compacted/cv-compact.md',
    'Synthetic candidate with Python and SQL experience. Literal token: Literal token: $& {{CANDIDATE_CV}}',
  );
  put('llm/prompts/cvgen/writing-style-guide.txt', 'Use plain, factual prose.');
  put(
    'llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt',
    'I build reliable Python services.',
  );
  const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
  const answer = {
    summary: words(55),
    core_competencies: ['Python', 'SQL', 'Testing', 'Services', 'Pipelines', 'Documentation'],
    experience: Object.fromEntries(
      roles.map((k, i) => [k, i < 3 ? ['Built services.', 'Wrote tests.'] : []]),
    ),
    projects: Object.fromEntries(
      projects.map((k, i) => [k, i < 3 ? 'Built a Python project.' : '']),
    ),
    skills: Object.fromEntries(Object.keys(worksheet.skills).map(k => [k, ['Python']])),
  };
  put('answer.json', JSON.stringify(answer));
  put('invalid-answer.json', JSON.stringify({ ...answer, summary: words(20) }));
  // A validation repair returns only the failed block, which the launcher merges.
  put('repair-block.json', JSON.stringify({ summary: words(60) }));
  // The failure that ends real runs: a literal newline inside a string value.
  put(
    'unparseable-answer.json',
    JSON.stringify(answer).replace(
      '"summary":"word0',
      '"summary":"word0' + String.fromCharCode(10),
    ),
  );
  put(
    'letter.txt',
    'I build reliable Python services with SQL and automated tests.\n\nThat work matches this role.',
  );
  put(
    'mock.mjs',
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {readFileSync,appendFileSync} from 'node:fs';import {join} from 'node:path';const original=cp.spawn;cp.spawn=function(command,args,options){if(command!=='fixture-claude')return original(command,args,options);const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{};let prompt='';p.stdin.on('data',b=>prompt+=b);p.stdin.on('finish',()=>queueMicrotask(()=>{appendFileSync(join(process.env.DRAFT_FIXTURE,'calls.jsonl'),JSON.stringify({args,prompt})+'\\n');const file=prompt.includes('I build reliable Python services.')?'letter.txt':prompt.includes('messed up the worksheet validation')?'repair-block.json':prompt.includes('not parseable JSON')?'invalid-answer.json':'unparseable-answer.json';p.stdout.write(JSON.stringify(args[0]==='auth'?{loggedIn:true,authMethod:'claude.ai'}:{result:readFileSync(join(process.env.DRAFT_FIXTURE,file),'utf8')}));p.emit('close',0);}));return p;};syncBuiltinESMExports();`,
  );
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    NODE_OPTIONS: '--import=' + pathToFileURL(join(fixture, 'mock.mjs')).href,
    DRAFT_FIXTURE: fixture,
  };
  const run = (script, args = [], input = '', expected = 0) => {
    const r = spawnSync(process.execPath, [join(fixture, script), ...args], {
      cwd: fixture,
      env,
      input,
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(r.status, expected, r.stderr + '\n' + r.stdout);
    return r.stdout;
  };
  const payload = {
    url: 'https://example.test/job/1',
    company: 'Example',
    role: 'Engineer',
    text: 'Build reliable Python and SQL services with automated tests and documentation. Toronto hybrid position. '.repeat(
      5,
    ),
  };
  run('src/scan/add-pasted-jd.mjs', ['--dry-run'], JSON.stringify(payload));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n, 0);
  run('src/scan/add-pasted-jd.mjs', [], JSON.stringify(payload));
  const job = (await db.query('SELECT * FROM jobs')).rows[0];
  assert.equal(
    Number((await db.query('SELECT revision FROM job_descriptions')).rows[0].revision),
    1,
    'initial tagged JD sync is idempotent',
  );
  run('src/scan/add-pasted-jd.mjs', [], JSON.stringify(payload), 1);
  const companyPreview = JSON.parse(
    run(
      'src/scan/add-pasted-jd.mjs',
      ['--dry-run'],
      JSON.stringify({ ...payload, url: 'https://example.test/job/2', company: 'eXaMpLe' }),
    ),
  );
  assert.equal(
    companyPreview.company,
    'Example',
    'unambiguous normalized company uses existing spelling',
  );
  assert.equal((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n, 1);
  run('src/helpers/move-status.mjs', [job.id, 'Applied', '--dry-run']);
  assert.equal((await db.query('SELECT status FROM jobs')).rows[0].status, 'Pending');
  run('src/helpers/move-status.mjs', [job.id, 'Applied', 'Acceptance fixture']);
  assert.equal((await db.query('SELECT status FROM jobs')).rows[0].status, 'Applied');
  const report = 'data/evaluations/fixture.md';
  put(
    report,
    '# Evaluation fixture\n\n## E. Customization Plan\n\nEmphasize Python and testing.\n\nPreserve the second customization paragraph.\n\n## F. Posting Legitimacy\n\nSynthetic test.\n',
  );
  await db.query("SELECT claim_work($1,'fixture',300)", ['evaluation:' + job.id]);
  await db.query("SELECT complete_evaluation($1,'fixture','fixture',4,$2,'Evaluated','fixture')", [
    job.id,
    report,
  ]);
  run('src/cvgen/draft-cv.mjs', ['--job=' + job.id, '--cover-letter', '--dry-run'], '', 1);
  run('src/cvgen/draft-cv.mjs', ['--job=' + job.id, '--dry-run']);
  assert.ok(!existsSync(join(fixture, 'calls.jsonl')));
  const draftResult = JSON.parse(run('src/cvgen/draft-cv.mjs', ['--job=' + job.id]));
  assert.equal(draftResult.validation_repair_attempted, true);
  assert.deepEqual(
    draftResult.repairs,
    ['json', 'validation'],
    'each failure class is repaired with its own targeted prompt',
  );
  assert.equal(draftResult.attempts, 3);
  const out = join(fixture, 'output/example/engineer--' + job.id);
  assert.ok(existsSync(join(out, 'cv-test-candidate.pdf')));
  assert.ok(!existsSync(join(out, 'cover-letter.md')), 'the CV run never drafts a letter');
  const readCalls = () =>
    readFileSync(join(fixture, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const calls = readCalls();
  assert.ok(
    calls.some(c => c.prompt.includes('Literal token: $& {{CANDIDATE_CV}}')),
    'inserted text remains literal',
  );
  assert.ok(
    calls.some(c => c.prompt.includes('Preserve the second customization paragraph.')),
    'all customization paragraphs reach the prompt',
  );
  const generations = calls.filter(c => c.args[0] !== 'auth');
  assert.equal(generations.length, 3, 'two failures cause exactly two repair calls');
  assert.ok(
    generations.every(c => !c.prompt.includes('I build reliable Python services.')),
    'the CV calls never see the cover-letter samples',
  );
  assert.ok(
    generations[1].prompt.includes('Bad control character'),
    'the JSON repair quotes the parser message',
  );
  assert.ok(
    generations[1].prompt.includes('"summary":"word0' + String.fromCharCode(10)),
    'the JSON repair returns the unparseable response verbatim',
  );
  assert.ok(
    generations[2].prompt.includes('$.summary: Response must provide a 45-75 word summary'),
  );
  assert.equal(
    generations[2].prompt.split('Synthetic candidate with Python and SQL experience.').length - 1,
    1,
    'the repair carries the compact CV once, inside the original instructions',
  );
  assert.ok(
    generations[2].prompt.includes(JSON.stringify(answer.projects[projects[0]])),
    'the validation repair shows the full previous response',
  );
  const final = JSON.parse(
    readFileSync(join(draftResult.run_directory, 'rendered', 'worksheet-response.json'), 'utf8'),
  );
  assert.equal(final.summary, words(60), 'the repaired block is merged in');
  assert.deepEqual(
    { ...final, summary: answer.summary },
    answer,
    'sections that passed validation are carried over unchanged',
  );
  const parseFailure = JSON.parse(
    readFileSync(join(draftResult.run_directory, 'repair-1-error.json'), 'utf8'),
  );
  assert.match(parseFailure.parse_error, /Bad control character/);
  const validation = JSON.parse(
    readFileSync(join(draftResult.run_directory, 'repair-2-error.json'), 'utf8'),
  );
  assert.deepEqual(
    Object.keys(validation.affected_json),
    ['summary'],
    'repair evidence isolates the invalid JSON section',
  );
  for (const name of [
    'repair-prompt.md',
    'repair-prompt-json.md',
    'repair-1-context.md',
    'repair-1-response.json',
    'repair-2-context.md',
    'repair-2-response.json',
    'repair-2-merged.json',
  ])
    assert.ok(existsSync(join(draftResult.run_directory, name)), name);
  // The letter is its own call with its own prompt, never a CV worksheet field.
  run('src/cvgen/draft-cover-letter.mjs', ['--job=' + job.id]);
  const letterCalls = readCalls()
    .slice(calls.length)
    .filter(c => c.args[0] !== 'auth');
  assert.equal(letterCalls.length, 1, 'the letter is exactly one more generation call');
  assert.ok(letterCalls[0].prompt.includes('I build reliable Python services.'));
  assert.ok(!letterCalls[0].prompt.includes('WORKSHEET_JSON_START'));
  assert.match(
    readFileSync(join(out, 'cover-letter.md'), 'utf8'),
    /^Dear hiring team,\n\nI build reliable Python services[\s\S]*Thank you,\nTest Candidate\n$/,
  );
  run('src/cvgen/publish-cover-letter.mjs', [join(out, 'cover-letter.md')]);
  assert.ok(existsSync(join(out, 'cover-letter.pdf')));
  assert.equal(
    (await db.query('SELECT status FROM jobs')).rows[0].status,
    'Applied',
    'late evaluation preserves manual status',
  );
  cpSync(out, join(base, 'rendered'), { recursive: true });
  console.log(
    'Drafting integration passed: intake preview/duplicate rejection, status preview/write, bounded JSON and block-merged validation repair, job-ID output, literal substitutions, separate CV and letter calls, real fonts and letter publication',
  );
} finally {
  await db.end();
  await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
  await admin.end();
  if (dirname(fixture) !== resolve(base) || !fixture.startsWith(join(resolve(base), 'run-')))
    throw new Error('Unsafe fixture cleanup');
  rmSync(fixture, { recursive: true, force: true });
}
