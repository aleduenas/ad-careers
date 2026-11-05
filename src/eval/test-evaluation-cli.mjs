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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  dimensions,
  weights,
  loadRubric,
  validateEvaluation,
  validateResearch,
  validateGate,
  render,
  researchNeeded,
  mergeResearch,
  companyPrompt,
  cachedJD,
  isManualJD,
} from './_evaluation-cli.mjs';
let admin, pool, schema, databaseURL;
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
import { root } from '../lib/root.mjs';
const base = join(root, 'logs', 'tests', 'evaluation');
mkdirSync(base, { recursive: true });
const fixture = mkdtempSync(join(base, 'run-'));
const put = (p, s) => {
  mkdirSync(dirname(join(fixture, p)), { recursive: true });
  writeFileSync(join(fixture, p), s);
};
const get = p => readFileSync(join(fixture, p), 'utf8');
const value = {
  legitimacy: 'High Confidence',
  note: 'Good fit',
  compensationBand: 'CAD $100,000-$120,000 base',
  scores: dimensions.map(d => ({ dimension: d, score: 4, evidence: 'Verified evidence' })),
  blocks: Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F'].map(k => [k, 'Meaningful fixture findings for ' + k]),
  ),
  keywords: Array.from({ length: 15 }, (_, i) => 'keyword' + i),
};
try {
  assert.equal(validateEvaluation(value), value);
  assert.doesNotThrow(() =>
    validateEvaluation({ ...value, keywords: Array.from({ length: 22 }, (_, i) => 'keyword' + i) }),
  );
  assert.throws(
    () =>
      validateEvaluation({
        ...value,
        keywords: Array.from({ length: 23 }, (_, i) => 'keyword' + i),
      }),
    /15-22 keywords/,
  );
  assert.throws(() => validateEvaluation({ ...value, scores: value.scores.slice(1) }));
  assert.throws(() => validateEvaluation({ ...value, blocks: { A: 'partial' } }));
  assert.throws(() => validateGate({ decision: 'PASS' }));
  assert.throws(() => validateResearch({ sections: { X: 'No sources' }, reason: 'ok' }, ['X']));
  assert.equal(isManualJD('---\nsource: manual-paste\nfetched: 2026-09-21\n---\n\nUS only'), true);
  assert.equal(
    isManualJD('---\nsource: workable\n---\n\nsource: manual-paste'),
    false,
    'only frontmatter identifies manual intake',
  );
  assert.equal(
    isManualJD('source: manual-paste'),
    false,
    'body text alone must not bypass the gate',
  );
  const job = {
    num: '1',
    date: '2026-09-16',
    company: 'Acme',
    role: 'Engineer',
    url: 'https://example.com/1',
    report_path: 'data/evaluations/1-acme.md',
  };
  const rendered = render(job, value);
  assert.equal(rendered.score, '4.0');
  assert.ok(rendered.report.includes('**Compensation band:** CAD $100,000-$120,000 base'));
  assert.equal(
    weights.reduce((a, b) => a + b, 0),
    100,
  );
  assert.equal(dimensions.length, 8, 'rubric must list 8 dimensions');
  assert.equal(new Set(dimensions).size, dimensions.length, 'rubric dimensions must be unique');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'rubric-'));
    mkdirSync(join(tmp, 'llm', 'prompts', 'eval'), { recursive: true });
    writeFileSync(
      join(tmp, 'llm', 'prompts', 'eval', 'scoring.md'),
      '| Dimension | Weight | x |\n|---|---:|---|\n| A | 60% | a |\n| B | 30% | b |\n',
    );
    assert.throws(
      () => loadRubric(tmp),
      /sum to 90/,
      'weights not summing to 100 must be rejected',
    );
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(
    render(job, null, { decision: 'MISSING', reason: 'No cached JD' }).status,
    'Discarded',
  );
  assert.equal(
    render(job, null, { decision: 'FAIL', reason: 'Wrong location' }).status,
    'Discarded',
  );
  const section = 'Company Reputation & Culture';
  const today = new Date().toISOString().slice(0, 10);
  const old =
    '## Unrelated\nKeep me\n\n## Layoffs & Hiring Signals\n\n**Last updated:** ' +
    today +
    '\nEvidence\n';
  const merged = mergeResearch(
    old,
    { sections: { [section]: 'Evidence ' + today + ' https://example.com/source' } },
    today,
  );
  assert.ok(merged.includes('Keep me'));
  assert.ok(merged.includes('## Layoffs'));
  put('data/company-info/acme.md', merged);
  assert.deepEqual(researchNeeded(join(fixture, 'data/company-info/acme.md')), []);
  assert.equal(mergeResearch(old, { sections: { [section]: null } }, today), old);
  assert.ok(!companyPrompt('Acme', [], '', today).includes('CANDIDATE_SECRET'));
  const aliasJob = {
    num: '1053',
    company: 'Lifemark Health Group',
    role: 'Senior Information Security Analyst',
    url: 'https://example.com/recruitment?jobId=603096&lang=en_CA',
  };
  put('data/jds/lifemark/senior-information-security-analyst.md', aliasJob.url + '\nCached JD');
  assert.equal(
    cachedJD(fixture, aliasJob),
    join(fixture, 'data/jds/lifemark/senior-information-security-analyst.md'),
    'display-name mismatch resolves by posting URL',
  );
  assert.equal(
    cachedJD(fixture, {
      ...aliasJob,
      url: 'https://example.com/recruitment?jobId=60309&lang=en_CA',
    }),
    null,
    'URL prefix must not match another requisition',
  );
  put('data/jds/duplicate/same-posting.md', aliasJob.url);
  assert.throws(
    () => cachedJD(fixture, aliasJob),
    /Ambiguous cached JD/,
    'multiple URL matches must not be guessed',
  );
  if (!process.env.TEST_DATABASE_URL) {
    console.log(
      'Evaluation validation tests passed; SKIPPED launcher integration without TEST_DATABASE_URL',
    );
  } else {
    const u = new URL(process.env.TEST_DATABASE_URL);
    if (!/^\/career_ops_test_[a-z0-9_]+$/.test(u.pathname))
      throw new Error('Refusing non-test database');
    schema = 'eval_' + randomUUID().replaceAll('-', '');
    admin = new pg.Client({ connectionString: u.toString() });
    await admin.connect();
    await admin.query('CREATE SCHEMA ' + schema);
    u.searchParams.set('options', '-c search_path=' + schema);
    databaseURL = u.toString();
    pool = new pg.Pool({ connectionString: databaseURL });
    for (const f of readdirSync(join(root, 'infra/sql/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort())
      await q(readFileSync(join(root, 'infra/sql/migrations', f), 'utf8'));
    cpSync(join(root, 'src'), join(fixture, 'src'), { recursive: true });
    cpSync(join(root, 'llm', 'prompts'), join(fixture, 'llm', 'prompts'), { recursive: true });
    put('llm/compacted/cv-compact.md', 'CANDIDATE_SECRET');
    put('llm/compacted/candidate-targeting.md', 'Candidate targeting');
    put(
      'config/evaluation-cli.json',
      JSON.stringify({ claude_command: 'fixture-claude', max_repairs: 1, max_concurrency: 2 }),
    );
    const rows = [
      '1 | https://example.com/1 | Acme | Engineer',
      '2 | https://example.com/2 | Acme | Analyst',
      '3 | https://example.com/3 | Missing | Engineer',
      '4 | https://example.com/4 | Review | Engineer',
      '5 | https://example.com/5 | Fail | Engineer',
      '8 | https://example.com/8 | Acme | Manual Analyst',
    ];
    for (const row of rows) {
      const [id, url, company, role] = row.split(' | ');
      await q('INSERT INTO jobs(id,url,url_key,company,role) VALUES($1,$2,$2,$3,$4)', [
        id,
        url,
        company,
        role,
      ]);
    }
    for (const [dir, role, body] of [
      ['acme', 'engineer', 'Toronto PASS'],
      ['acme', 'analyst', 'Toronto RETRY'],
      ['review', 'engineer', 'AMBIGUOUS'],
      ['fail', 'engineer', 'US_ONLY'],
      [
        'acme',
        'manual analyst',
        '---\nsource: manual-paste\nfetched: 2026-09-21\n---\n\nUS_ONLY manual fixture',
      ],
    ])
      put('data/jds/' + dir + '/' + role + '.md', body);
    const syncFixtures = async () => {
      for (const j of await q('SELECT * FROM jobs')) {
        const path = 'data/jds/' + j.company.toLowerCase() + '/' + j.role.toLowerCase() + '.md';
        if (existsSync(join(fixture, path)))
          await q('SELECT sync_job_description($1,$2,$3,$4)', [j.id, get(path), path, 'fixture']);
      }
    };
    await syncFixtures();
    assert.equal(cachedJD(fixture, job), join(fixture, 'data/jds/acme/engineer.md'));
    // The mock CLI must answer in the current worksheet shape (llm/prompts/eval/evaluate.md); 'value' above is the decoded internal shape.
    const rawAnswer = {
      legitimacy: 'High Confidence',
      verdict: 'Good fit',
      scores: Object.fromEntries(
        dimensions.map(d => [d, { score: 4, evidence: 'Verified evidence' }]),
      ),
      role_summary: {
        archetype: 'a',
        domain: 'd',
        function: 'f',
        seniority: 's',
        location: 'l',
        team: 't',
        summary: 'sum',
      },
      requirements: [
        { requirement: 'Req 1', evidence: 'Ev 1', match: 'Met', mitigation: 'NONE' },
        { requirement: 'Req 2', evidence: 'Ev 2', match: 'Gap', mitigation: 'Learn X' },
      ],
      level_and_strategy: { level: 'l', positioning: 'p', downlevel: 'd', floor: 'f' },
      comp_and_demand: {
        band: 'CAD $100,000-$120,000 base',
        band_min: '100000',
        band_max: '120000',
        band_currency: 'NONE',
        estimate_min: 'NONE',
        estimate_max: 'NONE',
      },
      customization_plan: { cv_changes: ['1', '2', '3', '4', '5'] },
      posting_legitimacy: { quality: 'q', stale: 's', assessment: 'a' },
      keywords: Array.from({ length: 15 }, (_, i) => 'term' + i),
    };
    put('fixture-response.json', JSON.stringify(rawAnswer));
    // Test-only process adapter: the real launcher and finalizer run unchanged.
    put(
      'mock-cli.mjs',
      `import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const original=cp.spawn;
cp.spawn=function(command,args,options){
 if(command!=='fixture-claude')return original(command,args,options);
 const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{};
 let text='';p.stdin.on('data',b=>text+=b);p.stdin.on('finish',()=>queueMicrotask(()=>{
  const base=process.env.EVALUATION_TEST_ROOT;
  appendFileSync(join(base,'calls.jsonl'),JSON.stringify({args,prompt:text,cwd:options.cwd})+'\\n');
  if(args[0]==='auth'){p.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));p.emit('close',0);return;}
  let answer;
  if(text.includes('Determine location eligibility'))answer={decision:text.includes('AMBIGUOUS')?'REVIEW':text.includes('US_ONLY')?'FAIL':'PASS',reason:'fixture location evidence',location:'Toronto, ON'};
  else if(text.startsWith('Research only this employer'))answer={limitations:'NONE',sections:{'Company Reputation & Culture':{evidence:[{fact:'Employer evidence',date:'2026-09-16',url:'https://example.com/company'}]},'Layoffs & Hiring Signals':{evidence:[{fact:'Hiring evidence',date:'2026-09-16',url:'https://example.com/hiring'}]}}};
  else if(text.startsWith('Research current Canadian'))answer={limitations:'NONE',sections:{'Role market':{evidence:[{fact:'Salary evidence',date:'2026-09-16',url:'https://example.com/pay'}]}}};
  else {if(text.includes('RETRY')&&!existsSync(join(base,'allow-retry'))){p.stderr.write('Simulated provider failure');p.emit('close',1);return;}answer=JSON.parse(readFileSync(join(base,'fixture-response.json'),'utf8'));}
  let response=JSON.stringify(answer);
  if(text.startsWith('Research only this employer')&&!text.includes('REPAIR ONLY'))response='{"invalid":"fixture repair exercise"}';
  p.stdout.write(JSON.stringify({result:response,usage:{}}));p.emit('close',0);
 }));return p;
};syncBuiltinESMExports();`,
    );
    const run = (args, code = 0) => {
      const r = spawnSync(
        process.execPath,
        [join(fixture, 'src/eval/evaluate-jobs.mjs'), ...args],
        {
          cwd: fixture,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            DATABASE_URL: databaseURL,
            NODE_OPTIONS: '--import=' + pathToFileURL(join(fixture, 'mock-cli.mjs')).href,
            EVALUATION_TEST_ROOT: fixture,
          },
        },
      );
      assert.equal(r.status, code, r.stderr + '\n' + r.stdout);
      return r.stdout;
    };
    const before = JSON.stringify(await q('SELECT * FROM jobs ORDER BY id'));
    run(['--next=5', '--dry-run']);
    assert.ok(!existsSync(join(fixture, 'calls.jsonl')));
    assert.equal(JSON.stringify(await q('SELECT * FROM jobs ORDER BY id')), before);
    const prepared = run(['--next=5', '--prepare-only']);
    const id = prepared.match(/Run: (.+)/)[1].trim();
    assert.ok(!existsSync(join(fixture, 'calls.jsonl')));
    assert.equal(JSON.stringify(await q('SELECT * FROM jobs ORDER BY id')), before);
    const first = run(['--resume=' + id], 2);
    assert.ok(first.includes('company research skipped'));
    const calls = () =>
      get('calls.jsonl')
        .trim()
        .split('\n')
        .map(s => JSON.parse(s));
    assert.equal(calls().filter(c => c.prompt.startsWith('Research only this employer')).length, 0);
    assert.equal(calls().filter(c => c.prompt.startsWith('Research current Canadian')).length, 2);
    for (const c of calls()) {
      assert.ok(c.cwd.startsWith(join(fixture, 'logs', 'workers')));
      if (c.prompt.startsWith('Research') || c.prompt.includes('Determine location eligibility'))
        assert.ok(!c.prompt.includes('CANDIDATE_SECRET'));
    }
    if (process.env.EVAL_TEST_DEBUG) {
      console.error('FIRST_OUTPUT>>>', first);
      console.error(
        'EVALS',
        JSON.stringify(await q('SELECT job_id,result_status,report_path FROM evaluations')),
      );
      console.error(
        'JOBS',
        JSON.stringify(await q('SELECT id,status,report_path FROM jobs ORDER BY id')),
      );
    }
    assert.equal(Number((await q('SELECT count(*) FROM evaluations')).at(0).count), 3);
    const firstEvalCount = calls().filter(c => c.prompt.startsWith('Evaluate the supplied')).length;
    put('allow-retry', 'yes');
    run(['--resume=' + id], 2);
    assert.equal(
      calls().filter(c => c.prompt.startsWith('Evaluate the supplied')).length,
      firstEvalCount + 1,
      'resume retries only failed evaluation',
    );
    assert.equal(
      calls().filter(c => c.prompt.startsWith('Research current Canadian')).length,
      2,
      'market responses reused',
    );
    assert.equal(
      Number((await q('SELECT count(*) FROM evaluations WHERE job_id=1')).at(0).count),
      1,
      'resume does not duplicate completion',
    );
    assert.equal((await q('SELECT status FROM jobs WHERE id=2'))[0].status, 'Evaluated');
    const gateCallsBeforeManual = calls().filter(c =>
      c.prompt.includes('Determine location eligibility'),
    ).length;
    const evaluationCallsBeforeManual = calls().filter(c =>
      c.prompt.startsWith('Evaluate the supplied'),
    ).length;
    const manual = run(['--job=8']);
    assert.ok(manual.includes('#8 eligibility: PASS (manual intake; location gate skipped)'));
    assert.equal(
      calls().filter(c => c.prompt.includes('Determine location eligibility')).length,
      gateCallsBeforeManual,
      'manual intake must not invoke the location gate',
    );
    assert.equal(
      calls().filter(c => c.prompt.startsWith('Evaluate the supplied')).length,
      evaluationCallsBeforeManual + 1,
      'manual intake still receives scored evaluation',
    );
    assert.equal((await q('SELECT status FROM jobs WHERE id=8'))[0].status, 'Evaluated');
    // New cache-missing company exercises one shared research request across roles.
    for (const [id, role] of [
      [6, 'Engineer'],
      [7, 'Analyst'],
    ])
      await q("INSERT INTO jobs(id,url,url_key,company,role) VALUES($1,$2,$2,'Newco',$3)", [
        id,
        'https://example.com/' + id,
        role,
      ]);
    put('data/jds/newco/engineer.md', 'Toronto');
    put('data/jds/newco/analyst.md', 'Toronto');
    await syncFixtures();
    run(['--select=Newco']);
    const companyCalls = calls().filter(c => c.prompt.startsWith('Research only this employer'));
    assert.equal(
      companyCalls.length,
      2,
      'one company research request plus one format repair for two jobs',
    );
    assert.equal(
      companyCalls.filter(c => c.args.includes('WebSearch,WebFetch')).length,
      1,
      'format repair must have no web tools',
    );
    assert.ok(companyCalls[1].prompt.includes('REPAIR ONLY'));
    assert.deepEqual(researchNeeded(join(fixture, 'data/company-info/newco.md')), []);
    const outputs = readdirSync(join(fixture, 'data/evaluations'));
    assert.ok(outputs.some(s => s.startsWith('6-')));
    console.log(
      'Evaluation CLI tests passed: rendering, validation, repo containment, dry-run, prepare, cache skip, research dedup, privacy, mixed outcomes, finalization and resumable failures.',
    );
  }
} finally {
  await pool?.end();
  if (admin) {
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  }
  if (dirname(fixture) !== resolve(base) || !fixture.startsWith(join(base, 'run-')))
    throw new Error('Unsafe test cleanup');
  rmSync(fixture, { recursive: true, force: true });
}
