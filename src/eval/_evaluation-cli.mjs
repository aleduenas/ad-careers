import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cliSpec, processRun, temporaryWorker } from '../lib/cli-runtime.mjs';
import { RESEARCH_SECTIONS, companyFreshness } from './_evaluation-plan.mjs';
import { logTokenUsage } from '../lib/_token-debug.mjs';
import { findCachedJD } from '../lib/_cached-jd.mjs';
import { renderPrompt, extractWorksheetJSON, sameShape } from '../lib/_prompt-templates.mjs';
import { root as promptRoot } from '../lib/root.mjs';
import { reportPhase } from '../lib/_task-status.mjs';

// Rubric authority: llm/prompts/eval/scoring.md. Dimension names and weights are parsed from its table.
export function loadRubric(root = promptRoot) {
  const text = readFileSync(join(root, 'llm', 'prompts', 'eval', 'scoring.md'), 'utf8');
  const rows = [...text.matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d+)%\s*\|/gm)].map(m => ({
    dimension: m[1],
    weight: Number(m[2]),
  }));
  if (!rows.length) throw new Error('No rubric rows found in llm/prompts/eval/scoring.md');
  const total = rows.reduce((n, r) => n + r.weight, 0);
  if (total !== 100) throw new Error('Rubric weights sum to ' + total + ', expected 100');
  return rows;
}
const rubric = loadRubric();
export const dimensions = rubric.map(r => r.dimension);
export const weights = rubric.map(r => r.weight);
export const titles = [
  'Role Summary',
  'Match with CV',
  'Level & Strategy',
  'Comp & Demand',
  'Customization Plan',
  'Posting Legitimacy',
];
export const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : '');
export const hash = s => createHash('sha256').update(s).digest('hex');
export function put(p, text) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p + '.tmp', text);
  renameSync(p + '.tmp', p);
}
export const json = (p, value) => put(p, JSON.stringify(value, null, 2) + '\n');
export const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
export function isManualJD(content) {
  const frontmatter =
    String(content || '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
  return /^source:[ \t]*manual-paste[ \t]*$/im.test(frontmatter);
}
export function cachedJD(root, job) {
  return findCachedJD(root, job);
}
export function researchNeeded(path, now) {
  return RESEARCH_SECTIONS.filter(s => !companyFreshness(path, now)[s]);
}
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
export function validateGate(v) {
  if (
    !['PASS', 'FAIL', 'REVIEW'].includes(v.decision) ||
    !nonempty(v.reason) ||
    !nonempty(v.location)
  )
    throw new Error('Expected decision PASS/FAIL/REVIEW, reason and location');
  return v;
}
export function validateResearch(v, sections) {
  if (!v || !v.sections || typeof v.sections !== 'object' || !nonempty(v.reason))
    throw new Error('Expected sections object and reason');
  for (const key of Object.keys(v.sections)) {
    if (!sections.includes(key)) throw new Error('Unexpected research section: ' + key);
    const value = v.sections[key];
    if (
      value !== null &&
      (!nonempty(value) ||
        !/https?:\/\//.test(value) ||
        !/\b\d{4}\b|Source date\/access: (?:UNKNOWN|UNAVAILABLE)/.test(value) ||
        /^## /m.test(value))
    )
      throw new Error(
        'Research needs source URLs and source dates at known precision (or explicitly unknown dates), with no level-two headings',
      );
  }
  if (sections.some(s => !(s in v.sections)))
    throw new Error('Return every requested section; null means unavailable');
  return v;
}
export function mergeResearch(previous, result, date) {
  let text = previous;
  const legacy = text.split(/^## /m)[0].match(/\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  if (legacy)
    text = text.replace(
      /(^## Layoffs & Hiring Signals\s*\n)([\s\S]*?)(?=^## |$(?![\s\S]))/m,
      (all, h, b) =>
        h + (/\*\*Last updated:/.test(b) ? b : '\n**Last updated:** ' + legacy + '\n' + b),
    );
  for (const [section, body] of Object.entries(result.sections)) {
    if (body === null) continue;
    const block = '## ' + section + '\n\n**Last updated:** ' + date + '\n\n' + body.trim() + '\n\n';
    const pattern = new RegExp('^## ' + section + '\\s*\\n[\\s\\S]*?(?=^## |$(?![\\s\\S]))', 'm');
    text = pattern.test(text)
      ? text.replace(pattern, () => block)
      : text.trimEnd() + '\n\n' + block;
  }
  return text;
}
export function researchSection(text, name) {
  const match = String(text || '').match(
    new RegExp(
      '^## ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n([\\s\\S]*?)(?=^## |$)',
      'm',
    ),
  );
  return match?.[1].trim() || 'UNAVAILABLE';
}
export function validateEvaluation(v) {
  if (
    !['High Confidence', 'Proceed with Caution', 'Suspicious'].includes(v.legitimacy) ||
    !nonempty(v.note) ||
    !nonempty(v.compensationBand) ||
    String(v.compensationBand).trim().toUpperCase().startsWith('UNKNOWN')
  )
    throw new Error('Missing legitimacy, note, or compensation band');
  if (!Array.isArray(v.scores) || v.scores.length !== 8)
    throw new Error('Exactly eight ordered scores required');
  for (const [i, s] of v.scores.entries())
    if (
      s.dimension !== dimensions[i] ||
      !Number.isFinite(s.score) ||
      s.score < 1 ||
      s.score > 5 ||
      !nonempty(s.evidence)
    )
      throw new Error('Invalid score: ' + dimensions[i]);
  if (
    !v.blocks ||
    ['A', 'B', 'C', 'D', 'E', 'F'].some(k => !nonempty(v.blocks[k]) || /^## /m.test(v.blocks[k]))
  )
    throw new Error('All six blocks required, without level-two headings');
  if (
    !Array.isArray(v.keywords) ||
    v.keywords.length < 15 ||
    v.keywords.length > 22 ||
    v.keywords.some(k => !nonempty(k))
  )
    throw new Error('15-22 keywords required (target 15-20)');
  return v;
}
const cell = s =>
  String(s)
    .replace(/[\t\r\n|]/g, ' ')
    .trim();
export function render(job, value, gate) {
  const stopped = gate && ['FAIL', 'MISSING'].includes(gate.decision);
  const subtotal = stopped
    ? 1
    : value.scores.reduce((n, s, i) => n + (s.score * weights[i]) / 100, 0);
  const score = Math.max(1, Math.min(5, subtotal)).toFixed(1);
  const legitimacy = stopped ? 'Proceed with Caution' : value.legitimacy;
  const note = stopped ? gate.reason : value.note;
  const status = stopped ? 'Discarded' : 'Evaluated';
  const compensationBand = stopped ? 'Not assessed' : cell(value.compensationBand);
  let report = `**Company:** ${job.company}\n**Role:** ${job.role}\n**Compensation band:** ${compensationBand}\n**Date:** ${job.date}\n**Score:** ${score}/5\n**URL:** ${job.url}\n**Legitimacy:** ${legitimacy}\n\n`;
  if (stopped) report += note + '\n';
  else {
    report +=
      '## Score Breakdown\n\n| Dimension | Weight | Score /5 | Contribution | Evidence |\n|---|---|---|---|---|\n';
    value.scores.forEach((s, i) => {
      report += `| ${s.dimension} | ${weights[i]}% | ${s.score} | ${((s.score * weights[i]) / 100).toFixed(3)} | ${cell(s.evidence)} |\n`;
    });
    report += `| **Weighted subtotal** | 100% | | **${subtotal.toFixed(3)}** | |\n`;
    report += `| **Final Score** | | | **${score}/5** | Weighted score, clamped to 1–5 |\n`;
    titles.forEach((title, i) => {
      const letter = String.fromCharCode(65 + i);
      report += `\n## ${letter}) ${title}\n\n${value.blocks[letter].trim()}\n`;
    });
    report += '\n## Keywords extracted\n\n' + value.keywords.join(', ') + '\n';
  }
  if (stopped) report = report.replace('**Score:** ' + score + '/5', '**Score:** Not assessed');
  return { report, score: stopped ? null : score, status, note };
}
export function companyPrompt(company, urls, cache, date) {
  return renderPrompt(promptRoot, 'eval/company-research.md', {
    COMPANY: company,
    EMPLOYER_URLS: urls.join(', ') || 'None known',
    EXISTING_CACHE: cache || 'No existing cache',
    DATE: date,
  });
}
export async function invoke(
  root,
  dir,
  phase,
  prompt,
  provider,
  config,
  research,
  validate,
  contract = null,
) {
  mkdirSync(dir, { recursive: true });
  const template = contract ? extractWorksheetJSON(prompt) : null;
  const signature = hash(JSON.stringify({ prompt, provider, config, research, version: 4 }));
  const checkpoint = join(dir, phase + '.json');
  if (existsSync(checkpoint)) {
    const old = JSON.parse(read(checkpoint));
    if (old.signature === signature) return validate(old.value);
  }
  let correction = '';
  let savedResearch = null;
  const researchAnswers = [];
  for (let attempt = 0; attempt <= config.max_repairs; attempt++) {
    // Dashboard task reporting. A multi-job run reports whichever job's call
    // started last; a dashboard launch is always a single job.
    reportPhase(phaseLabel(phase), attempt + 1);
    const prefix = join(dir, phase + '-' + Date.now() + '-' + attempt);
    put(prefix + '.prompt.txt', prompt + correction);
    const answer = await temporaryWorker(root, async cwd => {
      const response = join(cwd, 'response.txt');
      const spec = cliSpec(provider, config, response, { research: research && attempt === 0 });
      if (provider === 'codex') spec.args.splice(1, 0, '--json');
      const result = await processRun(spec.command, spec.args, {
        cwd,
        input: prompt + correction,
        timeout: config.timeout_ms,
      });
      logTokenUsage(root, {
        provider,
        model: config[provider + '_model'],
        workflow: 'evaluation',
        phase: phase + ' (attempt ' + (attempt + 1) + ')',
        runPath: dir,
        stdout: result.stdout,
        code: result.code,
      });
      put(prefix + '.stderr.log', result.stderr);
      put(prefix + '.stdout.log', result.stdout);
      if (result.code !== 0)
        throw new Error(provider + ' CLI failed; see ' + prefix + '.stderr.log');
      if (provider === 'codex') {
        if (!existsSync(response)) throw new Error('CLI returned no response');
        return read(response);
      }
      const envelope = JSON.parse(result.stdout);
      if (envelope.is_error || typeof envelope.result !== 'string')
        throw new Error('Claude failed; see ' + prefix + '.stdout.log');
      return envelope.result;
    });
    put(prefix + '.response.txt', answer);
    if (research) researchAnswers.push(answer);
    try {
      const raw = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
      let decoded;
      if (contract) {
        if (!sameShape(raw, template))
          throw new Error('Response did not preserve the worksheet keys/structure');
        if (contract.partial) {
          const partial = contract.decode(raw);
          savedResearch ||= { sections: {}, reason: '' };
          for (const [section, body] of Object.entries(partial.sections))
            if (body !== null || !(section in savedResearch.sections))
              savedResearch.sections[section] = body;
          savedResearch.reason = partial.reason;
          json(join(dir, phase + '.partial.json'), { signature, value: savedResearch });
        }
        decoded = contract.decode(raw, true);
        if (savedResearch) decoded = savedResearch;
      } else decoded = raw;
      const value = validate(decoded);
      json(checkpoint, { signature, value });
      return value;
    } catch (e) {
      if (attempt === config.max_repairs) {
        if (savedResearch && Object.values(savedResearch.sections).some(Boolean)) {
          savedResearch.reason = 'Partial evidence preserved after worksheet errors: ' + e.message;
          const value = validate(savedResearch);
          json(checkpoint, { signature, value });
          return value;
        }
        throw e;
      }
      correction =
        '\n' +
        renderPrompt(promptRoot, 'eval/repair.md', {
          VALIDATION_ERRORS: e.message,
          PREVIOUS_RESPONSES: research
            ? researchAnswers.join('\n--- saved response ---\n')
            : answer,
        });
    }
  }
}
// phaseLabel turns an internal phase key into the wording the dashboard's task
// monitor shows.
function phaseLabel(phase) {
  return (
    {
      gate: 'location gate',
      research: 'company research',
      market: 'market research',
      evaluation: 'scoring the role',
    }[phase] || phase
  );
}
export async function pool(items, limit, fn) {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
}
