import { getJD } from '../lib/_job-descriptions.mjs';
import { query, close } from '../lib/_database.mjs';
import { publishEvaluation, lease } from '../lib/_job-workflows.mjs';
import { passthrough, researchDecode, evaluationDecode } from './_evaluation-worksheet.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  read,
  put,
  json,
  hash,
  slug,
  isManualJD,
  researchNeeded,
  dimensions,
  validateGate,
  validateResearch,
  validateEvaluation,
  mergeResearch,
  researchSection,
  render,
  companyPrompt,
  invoke,
  pool,
} from './_evaluation-cli.mjs';
import { RESEARCH_SECTIONS } from './_evaluation-plan.mjs';
import { draftingRoot, temporaryWorker, checkLogin, processRun } from '../lib/cli-runtime.mjs';
import { renderPrompt } from '../lib/_prompt-templates.mjs';
import { reportPhase } from '../lib/_task-status.mjs';

import { root } from '../lib/root.mjs';
const sourceRevision = () => {
  try {
    return (
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }).trim() || 'UNAVAILABLE'
    );
  } catch {
    return 'UNAVAILABLE';
  }
};
const options = {};
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (!m) throw new Error('Use --option=value');
  options[m[1]] = m[2] ?? true;
}
const allowed = [
  'job',
  'select',
  'next',
  'provider',
  'dry-run',
  'prepare-only',
  'resume',
  'doctor',
  'smoke',
  'smoke-research',
  'smoke-evaluation',
  'help',
];
for (const key of Object.keys(options))
  if (!allowed.includes(key)) throw new Error('Unknown option: ' + key);
if (options.help || !Object.keys(options).length) {
  console.log(
    'Usage: node src/eval/evaluate-jobs.mjs --job=123 | --select="company role" | --next=5\nOptions: --provider=claude|codex --dry-run --prepare-only\nResume: --resume=RUN_ID\nDiagnostics: --doctor --smoke',
  );
  process.exit(0);
}
const cvConfig = JSON.parse(read(join(root, 'config/cv-drafting.json')) || '{}');
const config = {
  default_provider: 'claude',
  claude_command: cvConfig.claude_command || 'claude',
  codex_command: cvConfig.codex_command || 'codex',
  claude_model: 'sonnet',
  claude_research_model: 'haiku',
  codex_model: 'gpt-5.5',
  codex_research_model: 'gpt-5.5',
  timeout_ms: 600000,
  max_repairs: 2,
  max_concurrency: 2,
  ...JSON.parse(read(join(root, 'config/evaluation-cli.json')) || '{}'),
};
const provider = options.provider || config.default_provider;
if (!['claude', 'codex'].includes(provider)) throw new Error('Provider must be claude or codex');
for (const key of ['timeout_ms', 'max_concurrency'])
  if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error('Invalid ' + key);
if (!Number.isInteger(config.max_repairs) || config.max_repairs < 0 || config.max_repairs > 3)
  throw new Error('max_repairs must be 0–3');
if (!config[provider + '_model'] || !config[provider + '_research_model'])
  throw new Error('Explicit evaluation and research models required');
const archive = draftingRoot(root, 'logs/evaluation');
const researchConfig = { ...config, [provider + '_model']: config[provider + '_research_model'] };
async function script(name, args) {
  const r = await processRun(process.execPath, [join(root, 'src', 'eval', name), ...args], {
    cwd: root,
    timeout: config.timeout_ms,
  });
  if (r.code !== 0) throw new Error(name + ': ' + r.stderr + '\n' + r.stdout);
  return r.stdout;
}
if (options.doctor) {
  console.log(
    JSON.stringify(await temporaryWorker(root, cwd => checkLogin(provider, config, cwd))),
  );
  process.exit(0);
}
if (options.smoke || options['smoke-research'] || options['smoke-evaluation']) {
  await temporaryWorker(root, cwd => checkLogin(provider, config, cwd));
  const dir = join(archive, 'smoke-' + randomUUID());
  if (options['smoke-research']) {
    const prompt = renderPrompt(root, 'eval/market-research.md', {
      COMPANY: 'City of Toronto (smoke test)',
      ROLE: 'Use web search to find the official City of Toronto website and retrieve its public home page as the only finding. One search and one fetch maximum.',
      LOCATION: 'Toronto, ON',
      DATE: new Date().toISOString().slice(0, 10),
    });
    await invoke(
      root,
      dir,
      'research-smoke',
      prompt,
      provider,
      researchConfig,
      true,
      v => {
        validateResearch(v, ['Role market']);
        if (!v.sections['Role market']) throw new Error('Web tools unavailable: ' + v.reason);
        return v;
      },
      { decode: researchDecode(['Role market']), partial: true },
    );
  } else if (options['smoke-evaluation']) {
    const prompt = renderPrompt(root, 'eval/evaluate.md', {
      SCORING_RUBRIC: 'Synthetic rubric for a smoke test only; score every dimension at 3.',
      CANDIDATE_FACTS:
        'Candidate: 3 years Python, SQL and security automation, located in Toronto.',
      TARGETING:
        'Candidate targets security engineering roles, CAD 100000 minimum, Toronto/remote-Canada only.',
      COMPANY: 'Smoke Test Inc.',
      ROLE: 'Security Automation Engineer',
      DATE: new Date().toISOString().slice(0, 10),
      JOB_DESCRIPTION:
        'Fictional JD: Toronto hybrid security automation engineer, 3 years experience, CAD 100000-120000 base. Keywords: Python, SQL, automation, security, monitoring, incident response, cloud, Linux, Docker, testing, CI/CD, APIs, logging, documentation, collaboration.',
      MARKET_SALARY_CONTEXT:
        'No inferred salary context: the JD contains an advertised compensation band.',
      SCAN_HISTORY: 'None.',
    });
    await invoke(
      root,
      dir,
      'evaluation-smoke',
      prompt,
      provider,
      config,
      false,
      validateEvaluation,
      { decode: evaluationDecode(dimensions) },
    );
  } else
    await invoke(
      root,
      dir,
      'smoke',
      'Return only {"ok":true}. No tools.',
      provider,
      config,
      false,
      v => {
        if (v.ok !== true) throw new Error('Smoke mismatch');
        return v;
      },
    );
  console.log('CLI smoke passed: ' + dir);
  process.exit(0);
}
let state, runDir;
if (options.resume) {
  if (typeof options.resume !== 'string' || !/^\d{4}-[\w-]+$/.test(options.resume))
    throw new Error('Use a run ID printed by the launcher');
  if (['job', 'select', 'next', 'prepare-only', 'dry-run'].some(k => options[k]))
    throw new Error('Resume cannot be combined with selection or preparation');
  runDir = join(archive, options.resume);
  state = JSON.parse(read(join(runDir, 'run.json')));
  if (state.provider !== provider) throw new Error('Resume with --provider=' + state.provider);
  if (state.status === 'complete') {
    console.log(JSON.stringify(state.results, null, 2));
    process.exit(0);
  }
} else {
  if (['job', 'select', 'next'].filter(k => options[k] !== undefined).length !== 1)
    throw new Error('Choose exactly one of --job, --select, --next');
  if (options.job && !/^\d+$/.test(options.job))
    throw new Error('Job must be a permanent numeric ID');
  if (options.next && !/^[1-9]\d*$/.test(options.next))
    throw new Error('Next must be a positive integer');
  if (options.select && (typeof options.select !== 'string' || !options.select.trim()))
    throw new Error('Select needs a nonempty search term');
  const found = JSON.parse(
    await script('next-jobs.mjs', [
      '--json',
      options.job ? '--id=' + options.job : String(options.next || 1),
      ...(options.select ? ['--select=' + options.select] : []),
    ]),
  );
  const selected = options.job ? found.jobs.filter(j => j.num === String(options.job)) : found.jobs;
  if (!selected.length)
    throw new Error(
      'No matching Pending jobs. Use a pending permanent ID or --select="company role".',
    );
  const date = new Date().toISOString().slice(0, 10),
    id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  runDir = join(archive, id);
  const jobs = await Promise.all(
    selected.map(async ({ pipeline_line, ...job }) => {
      const jd = await getJD(job.num),
        cache = join(root, 'data', 'company-info', slug(job.company) + '.md');
      return {
        ...job,
        date,
        jd_path: jd?.file_path || null,
        jd: jd?.content || null,
        manual_jd: isManualJD(jd?.content),
        company_slug: slug(job.company),
        cache_path: relative(root, cache),
        refresh_sections: researchNeeded(cache),
      };
    }),
  );
  if (options['dry-run']) {
    console.log(
      JSON.stringify(
        {
          provider,
          models: {
            evaluation: config[provider + '_model'],
            research: config[provider + '_research_model'],
          },
          jobs: jobs.map(({ jd, ...j }) => j),
          note: 'Company research scheduled only after eligibility PASS; fresh cache skips company CLI.',
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  state = {
    id,
    provider,
    status: 'prepared',
    jobs,
    results: [],
    created_at: new Date().toISOString(),
    sources: {},
  };
  for (const path of [
    'llm/compacted/cv-compact.md',
    'llm/compacted/candidate-targeting.md',
    'llm/prompts/eval/scoring.md',
    'llm/prompts/eval/gate.md',
    'llm/prompts/eval/evaluate.md',
    'llm/prompts/eval/company-research.md',
    'llm/prompts/eval/market-research.md',
    'llm/prompts/eval/repair.md',
    'llm/prompts/runtime/no-tools.md',
    'llm/prompts/runtime/research.md',
  ]) {
    const content = read(join(root, path));
    if (!content) throw new Error('Required input missing: ' + path);
    state.sources[path] = content;
  }
  for (const j of jobs)
    j.scan_history = (
      await query(
        'SELECT * FROM scan_history WHERE lower(company)=lower($1) AND (lower(title)=lower($2) OR url=$3) ORDER BY id DESC LIMIT 30',
        [j.company, j.role, j.url],
      )
    )
      .reverse()
      .map(r =>
        [r.url, r.first_seen, r.portal, r.title, r.company, r.status, r.location].join('\t'),
      )
      .join('\n');
}
mkdirSync(archive, { recursive: true });
const releases = [],
  ownerToken = randomUUID();
const save = () => json(join(runDir, 'run.json'), state);
try {
  state.worker_runtime ??= {
    source_revision: sourceRevision(),
    provider,
    evaluation_model: config[provider + '_model'],
    research_model: config[provider + '_research_model'],
    system_prompt_paths:
      provider === 'claude'
        ? ['llm/prompts/runtime/no-tools.md', 'llm/prompts/runtime/research.md']
        : [],
    web_search:
      provider === 'codex'
        ? 'live for research; disabled otherwise'
        : 'WebSearch/WebFetch for research; no tools otherwise',
  };
  for (const [path, content] of Object.entries(state.sources))
    put(join(runDir, 'prompt-sources', path), content);
  releases.push(await lease('evaluation-run:' + state.id, ownerToken));
  save();
  for (const j of state.jobs)
    if (!j.manual_jd)
      put(
        join(runDir, j.num, 'gate.prompt.txt'),
        renderPrompt(root, 'eval/gate.md', { CACHED_JD: j.jd || 'No cached JD' }),
      );
  console.log('Run: ' + state.id);
  reportPhase('preparing');
  if (options['prepare-only']) {
    console.log('Prepared without CLI calls or tracker changes. Resume with --resume=' + state.id);
  } else {
    state.staged ||= {};
    for (const [path, content] of Object.entries(state.sources))
      if (read(join(root, path)) !== content)
        throw new Error('Inputs changed; start a new run: ' + path);
    for (const j of state.jobs)
      if ((await getJD(j.num))?.content !== (j.jd ?? undefined))
        throw new Error('Cached JD changed; start a new run: ' + j.num);
    if (state.jobs.some(j => j.jd && !state.staged[j.num]))
      await temporaryWorker(root, cwd => checkLogin(provider, config, cwd));
    for (const j of state.jobs) releases.push(await lease('evaluation:' + j.num, ownerToken));
    state.status = 'running';
    save();
    const failures = new Map(),
      gates = new Map();
    await pool(state.jobs, config.max_concurrency, async j => {
      if (state.staged[j.num]) return;
      try {
        const manual = j.manual_jd === true || isManualJD(j.jd);
        const gate = manual
          ? {
              decision: 'PASS',
              reason: 'Manual JD intake; location gate skipped by policy',
              location: 'UNKNOWN',
            }
          : j.jd
            ? await invoke(
                root,
                join(runDir, j.num),
                'gate',
                read(join(runDir, j.num, 'gate.prompt.txt')),
                provider,
                researchConfig,
                false,
                validateGate,
                passthrough,
              )
            : { decision: 'MISSING', reason: 'No cached JD', location: 'UNKNOWN' };
        gates.set(j.num, gate);
        console.log(
          '#' +
            j.num +
            ' eligibility: ' +
            gate.decision +
            (manual ? ' (manual intake; location gate skipped)' : ''),
        );
      } catch (e) {
        failures.set(j.num, e.message);
      }
    });
    const passed = state.jobs.filter(j => gates.get(j.num)?.decision === 'PASS');
    const companies = [...new Set(passed.map(j => j.company_slug))];
    const companyEvidence = new Map();
    await pool(companies, config.max_concurrency, async company => {
      const jobs = passed.filter(j => j.company_slug === company),
        j = jobs[0],
        path = join(root, j.cache_path),
        before = read(path),
        sections = researchNeeded(path);
      let result = { sections: {}, reason: 'Fresh company cache reused' };
      if (sections.length) {
        let releaseResearch;
        console.log(j.company + ': researching ' + sections.length + ' missing/stale section(s)');
        try {
          releaseResearch = await lease('research:' + company, ownerToken);
          result = await invoke(
            root,
            join(runDir, 'companies', company),
            'research',
            companyPrompt(
              j.company,
              jobs.map(j => j.url),
              before,
              j.date,
            ),
            provider,
            researchConfig,
            true,
            v => validateResearch(v, RESEARCH_SECTIONS),
            { decode: researchDecode(RESEARCH_SECTIONS), partial: true },
          );
          await releaseResearch.assert();
          if (read(path) !== before) throw new Error('Company cache changed during research');
          if (Object.values(result.sections).some(v => v !== null))
            put(path, mergeResearch(before, result, j.date));
        } catch (e) {
          result = {
            sections: Object.fromEntries(RESEARCH_SECTIONS.map(s => [s, null])),
            reason: 'Research unavailable: ' + e.message,
          };
        } finally {
          await releaseResearch?.();
        }
      } else console.log(j.company + ': company research skipped (fresh cache)');
      companyEvidence.set(company, { cache: read(path), result });
    });
    const completed = [];
    state.results = [];
    await pool(state.jobs, config.max_concurrency, async j => {
      if (state.staged[j.num]) {
        if (!existsSync(join(runDir, 'reports', j.num + '.md')))
          throw new Error('Staged report missing: ' + j.num);
        await publishEvaluation(
          j,
          state.staged[j.num].result,
          read(join(runDir, 'reports', j.num + '.md')),
          ownerToken,
          state.id,
        );
        completed.push(j);
        state.results.push(state.staged[j.num].result);
        return;
      }
      const gate = gates.get(j.num);
      if (failures.has(j.num)) {
        state.results.push({ num: j.num, status: 'FAILED', note: failures.get(j.num) });
        return;
      }
      if (gate.decision === 'REVIEW') {
        state.results.push({ num: j.num, status: 'REVIEW', note: gate.reason });
        return;
      }
      try {
        let value;
        if (gate.decision === 'PASS') {
          let market;
          const marketPrompt = renderPrompt(root, 'eval/market-research.md', {
            COMPANY: j.company,
            ROLE: j.role,
            LOCATION: gate.location || 'UNKNOWN',
            DATE: j.date,
          });
          try {
            market = await invoke(
              root,
              join(runDir, j.num),
              'market',
              marketPrompt,
              provider,
              researchConfig,
              true,
              v => validateResearch(v, ['Role market']),
              { decode: researchDecode(['Role market']), partial: true },
            );
          } catch (e) {
            market = {
              sections: { 'Role market': null },
              reason: 'Role market research unavailable: ' + e.message,
            };
          }
          const source = state.sources;
          const hasAdvertisedBand = /(?:CAD|USD|\$|€|£)\s*\d|\d[\d,]*\s*(?:CAD|USD)/i.test(j.jd);
          const marketResearch = market.sections['Role market'] || 'UNAVAILABLE — ' + market.reason;
          const marketSalary =
            marketResearch
              .split(/\n\n/)
              .filter(item => /(?:CAD|USD|\$|€|£)\s*\d|\d[\d,]*\s*(?:CAD|USD)/i.test(item))
              .join('\n\n') || 'No numeric salary benchmark was found.';
          const prompt = renderPrompt(root, 'eval/evaluate.md', {
            SCORING_RUBRIC: source['llm/prompts/eval/scoring.md'],
            CANDIDATE_FACTS: source['llm/compacted/cv-compact.md'],
            TARGETING: source['llm/compacted/candidate-targeting.md'],
            COMPANY: j.company,
            ROLE: j.role,
            DATE: j.date,
            JOB_DESCRIPTION: j.jd,
            MARKET_SALARY_CONTEXT: hasAdvertisedBand
              ? 'No inferred salary context: the JD contains an advertised compensation band.'
              : marketSalary,
            SCAN_HISTORY: j.scan_history || 'No prior sightings recorded.',
          });
          const companyCache = companyEvidence.get(j.company_slug)?.cache || '';
          const research = {
            market: marketResearch,
            employer: researchSection(companyCache, 'Company Reputation & Culture'),
            hiring: researchSection(companyCache, 'Layoffs & Hiring Signals'),
          };
          value = await invoke(
            root,
            join(runDir, j.num),
            'evaluation',
            prompt,
            provider,
            config,
            false,
            validateEvaluation,
            { decode: evaluationDecode(dimensions, research) },
          );
        }
        for (const [path, content] of Object.entries(state.sources))
          if (hash(read(join(root, path))) !== hash(content))
            throw new Error('Inputs changed; start a new run: ' + path);
        if ((await getJD(j.num))?.content !== (j.jd ?? undefined))
          throw new Error('Cached JD changed; start a new run');
        const output = render(j, value, gate);
        put(join(runDir, 'reports', j.num + '.md'), output.report);

        completed.push(j);
        const result = {
          num: j.num,
          company: j.company,
          role: j.role,
          score: output.score,
          status: output.status,
          note: output.note,
        };
        state.staged[j.num] = { result };
        save();
        await publishEvaluation(j, result, output.report, ownerToken, state.id);
        state.results.push(result);
        save();
        console.log(
          '#' +
            j.num +
            ' ' +
            output.status +
            ' ' +
            (output.score == null ? 'Not assessed' : output.score + '/5'),
        );
      } catch (e) {
        state.results.push({ num: j.num, company: j.company, status: 'FAILED', note: e.message });
      }
    });
    for (const r of state.results.filter(r => ['FAILED', 'REVIEW'].includes(r.status)))
      await query(
        "UPDATE jobs SET evaluation_error=$2,updated_at=now() WHERE id=$1 AND EXISTS(SELECT 1 FROM workflow_claims WHERE resource='evaluation:'||jobs.id AND owner_token=$3 AND expires_at>now())",
        [r.num, r.note, ownerToken],
      );
    state.status = 'finalizing';
    save();
    state.status = state.results.some(r => ['FAILED', 'REVIEW'].includes(r.status))
      ? 'needs-attention'
      : 'complete';
    save();
    console.log(
      JSON.stringify({ run_id: state.id, status: state.status, results: state.results }, null, 2),
    );
    if (state.status !== 'complete') process.exitCode = 2;
  }
} catch (e) {
  state.status = 'failed';
  state.error = e.message;
  save();
  console.error(e.message + '\nResume with --resume=' + state.id);
  process.exitCode = 1;
} finally {
  for (const release of releases.reverse())
    try {
      await release();
    } catch (e) {
      console.error('Lease release failed: ' + e.message);
    }
  await close();
}
