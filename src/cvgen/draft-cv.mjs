#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { logTokenUsage } from '../lib/_token-debug.mjs';
import {
  draftingRoot,
  temporaryWorker,
  childOf,
  cliSpec,
  processRun,
  checkLogin,
} from '../lib/cli-runtime.mjs';
import {
  resolveJob,
  candidateFileStem,
  withOutputLock,
  customizationContext,
} from './_cv-drafting.mjs';
import {
  parseWorksheet,
  parseAnswer,
  validateAnswer,
  mergeRepair,
  adapt,
  CVWorksheetValidationError,
  CVPageBudgetError,
} from './_cv-worksheet.mjs';
import { loadCatalog, renderHTML } from './_cv-content.mjs';
import { renderPrompt } from '../lib/_prompt-templates.mjs';
import { reportPhase } from '../lib/_task-status.mjs';

import { root } from '../lib/root.mjs';
const options = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const n = a.indexOf('=');
    return n < 0 ? [a.slice(2), true] : [a.slice(2, n), a.slice(n + 1)];
  }),
);
const config = {
  max_repairs: 2,
  max_pages: 2,
  ...JSON.parse(readFileSync(join(root, 'config/cv-drafting.json'), 'utf8')),
};
const provider = options.provider || config.default_provider;
if (!['claude', 'codex'].includes(provider)) throw new Error('Provider must be claude or codex');
if (!Number.isInteger(config.max_repairs) || config.max_repairs < 0 || config.max_repairs > 3)
  throw new Error('max_repairs must be 0–3');
if (!Number.isInteger(config.max_pages) || config.max_pages < 1 || config.max_pages > 4)
  throw new Error('max_pages must be 1–4');
if (options.smoke) throw new Error('--smoke is not supported by the CV workflow.');
// The CV and the cover letter are always separate calls with separate prompts:
// one worker drafting both overfit the letter to the CV and invented facts.
if (options['cover-letter'] || options['letter-only'])
  throw new Error(
    'draft-cv.mjs drafts only the CV; run node src/cvgen/draft-cover-letter.mjs for the letter.',
  );
const archive = draftingRoot(root, config.drafting_root);
const promptPath = join(root, 'llm', 'prompts', 'cvgen', 'cv-worksheet.md');
const repairPromptPath = join(root, 'llm', 'prompts', 'cvgen', 'cv-repair.md');
const jsonRepairPromptPath = join(root, 'llm', 'prompts', 'cvgen', 'cv-repair-json.md');
const lengthRepairPromptPath = join(root, 'llm', 'prompts', 'cvgen', 'cv-repair-length.md');
const stylePath = join(root, 'llm', 'prompts', 'cvgen', 'writing-style-guide.txt');
const promptSource = readFileSync(promptPath, 'utf8');
const writingStyle = readFileSync(stylePath, 'utf8');
const worksheet = parseWorksheet(promptSource);
if (options.init) {
  mkdirSync(join(archive, 'runs'), { recursive: true });
  console.log('Drafting workspace initialized: ' + archive);
  process.exit(0);
}
if (options.doctor) {
  for (const p of ['claude', 'codex'])
    try {
      console.log(JSON.stringify(await temporaryWorker(root, cwd => checkLogin(p, config, cwd))));
    } catch (e) {
      console.error(p + ': ' + e.message);
      process.exitCode = 1;
    }
  process.exit(process.exitCode || 0);
}
const selection = options.job
  ? await resolveJob(root, String(options.job))
  : {
      jd: options.jd && resolve(root, options.jd),
      report: options.report && resolve(root, options.report),
      out: options.out && resolve(root, options.out),
    };
if (!selection.jd || !selection.out)
  throw new Error('Use --job=ID or --jd=... --report=... --out=output/company/role');
if (!selection.report && !options['without-report'])
  throw new Error('Evaluation required; --without-report needs prior user authorization');
if (!childOf(join(root, 'output'), selection.out))
  throw new Error('Output must be below the repository output directory');
const cv = readFileSync(join(root, 'llm', 'compacted', 'cv-compact.md'), 'utf8'),
  jd = selection.jdContent ?? readFileSync(selection.jd, 'utf8');
const report =
  selection.report && existsSync(selection.report) ? readFileSync(selection.report, 'utf8') : '';
const customization = customizationContext(report);
const context = renderPrompt(root, 'cvgen/cv-worksheet.md', {
  JOB_DESCRIPTION: jd.trimEnd(),
  CANDIDATE_CV: cv.trimEnd(),
  WRITING_STYLE: writingStyle.trimEnd(),
  CV_CUSTOMIZATION_CONTEXT: customization,
});
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8),
  work = join(archive, 'runs', runId);
if (options['dry-run']) {
  console.log(
    JSON.stringify({ provider, prompt: promptPath, run_directory: work, ...selection }, null, 2),
  );
  process.exit(0);
}
if (!options['prepare-only']) await temporaryWorker(root, cwd => checkLogin(provider, config, cwd));
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'cv.md'), cv);
writeFileSync(join(work, 'job-description.md'), jd);
copyFileSync(promptPath, join(work, 'worksheet.md'));
copyFileSync(repairPromptPath, join(work, 'repair-prompt.md'));
copyFileSync(jsonRepairPromptPath, join(work, 'repair-prompt-json.md'));
copyFileSync(lengthRepairPromptPath, join(work, 'repair-prompt-length.md'));
copyFileSync(stylePath, join(work, 'writing-style-guide.txt'));
writeFileSync(join(work, 'cv-customization-context.md'), customization + '\n');
writeFileSync(join(work, 'cli-context.md'), context);
if (options['prepare-only']) {
  console.log(
    JSON.stringify({ status: 'prepared', run_directory: work, prompt: promptPath }, null, 2),
  );
  process.exit(0);
}
const stage = join(work, 'rendered');
mkdirSync(stage, { recursive: true });
const fileStem = candidateFileStem(root);
const repairs = [];
// repairFor turns one failed attempt into the next attempt's targeted prompt.
// A worksheet that fails validation is repaired block by block: the prompt shows
// the previous answer in full, the path/reason pairs and the failed block, and
// asks for only the fixed block, which mergeRepair splices back in. A response
// that does not parse is corrected from the parser message and its own verbatim
// text. A worksheet that validates and renders but exceeds the page budget asks
// for a full revised worksheet (not a block, since no single JSON path is at
// fault) and replaces the previous answer outright. Anything else (a CLI or
// transport failure) has nothing to target, so the same input is simply re-run.
function repairFor(error, raw, previous) {
  if (error instanceof CVWorksheetValidationError)
    return {
      kind: 'validation',
      error: { issues: error.issues, affected_json: error.affected },
      prompt: renderPrompt(root, 'cvgen/cv-repair.md', {
        ORIGINAL_PROMPT: context.trimEnd(),
        PREVIOUS_RESPONSE: JSON.stringify(previous, null, 2),
        VALIDATION_ERRORS: error.issues.map(issue => `${issue.path}: ${issue.reason}`).join('\n'),
        AFFECTED_JSON: JSON.stringify(error.affected, null, 2),
      }),
    };
  if (error instanceof SyntaxError && typeof raw === 'string')
    return {
      kind: 'json',
      error: { parse_error: error.message },
      prompt: renderPrompt(root, 'cvgen/cv-repair-json.md', {
        ORIGINAL_PROMPT: context.trimEnd(),
        PARSE_ERROR: error.message,
        PREVIOUS_RESPONSE: raw.trimEnd(),
      }),
    };
  if (error instanceof CVPageBudgetError)
    return {
      kind: 'length',
      error: { page_count: error.pageCount, max_pages: error.maxPages },
      prompt: renderPrompt(root, 'cvgen/cv-repair-length.md', {
        ORIGINAL_PROMPT: context.trimEnd(),
        PREVIOUS_RESPONSE: JSON.stringify(error.answer, null, 2),
        PAGE_COUNT: String(error.pageCount),
        MAX_PAGES: String(error.maxPages),
      }),
    };
  return null;
}
await withOutputLock(archive, selection.out, 'cv', runId, async () => {
  try {
    const invoke = async (input, phase, responseName, stderrName) =>
      temporaryWorker(root, async cwd => {
        const response = join(cwd, 'response.txt'),
          spec = cliSpec(provider, config, response);
        if (provider === 'codex') spec.args.splice(1, 0, '--json');
        const result = await processRun(spec.command, spec.args, {
          cwd,
          input,
          timeout: config.timeout_ms,
        });
        logTokenUsage(root, {
          provider,
          model: config[provider + '_model'],
          workflow: 'cv',
          phase,
          runPath: work,
          stdout: result.stdout,
          code: result.code,
        });
        writeFileSync(join(work, stderrName), result.stderr);
        if (result.code !== 0) throw new Error(provider + ' failed: ' + result.stderr);
        let raw;
        if (provider === 'claude') {
          const data = JSON.parse(result.stdout);
          if (data.is_error || typeof data.result !== 'string')
            throw new Error('Claude returned no worksheet');
          raw = data.result;
        } else {
          if (!existsSync(response)) throw new Error('Codex returned no worksheet');
          raw = readFileSync(response, 'utf8');
        }
        writeFileSync(join(work, responseName), raw);
        return raw;
      });
    // Every failure class shares one budget: the first call plus config.max_repairs
    // retries, each carrying whatever correction its failure allows. Once an answer
    // has failed validation, `base` holds it and `pending` its issues; every later
    // response (including a JSON-syntax repair of a block) is a block merged into
    // `base` before validation. A page-budget failure carries no `base`, so its
    // repair response (a full worksheet) is used as is.
    let input = context,
      answer,
      base = null,
      pending = null,
      htmlPath,
      pdfPath;
    const catalog = loadCatalog(root),
      template = readFileSync(
        join(root, 'src', 'cvgen', 'templates', 'cv-structured.html'),
        'utf8',
      );
    for (let attempt = 0; ; attempt++) {
      const tag = attempt === 0 ? '' : 'repair-' + attempt + '-';
      reportPhase(attempt === 0 ? 'drafting worksheet' : 'repairing worksheet', attempt + 1);
      let raw;
      try {
        raw = await invoke(
          input,
          attempt === 0 ? 'initial worksheet' : 'repair ' + attempt,
          tag + 'response.json',
          tag + 'stderr.log',
        );
        const parsed = parseAnswer(raw),
          candidate = base ? mergeRepair(base, parsed, pending) : parsed;
        if (base)
          writeFileSync(join(work, tag + 'merged.json'), JSON.stringify(candidate, null, 2) + '\n');
        answer = validateAnswer(candidate, worksheet);
        // A page-budget repair returns a full worksheet, not a block, so the
        // next attempt (success or otherwise) must not merge into stale state.
        base = null;
        pending = null;

        writeFileSync(
          join(stage, 'worksheet-response.json'),
          JSON.stringify(answer, null, 2) + '\n',
        );
        const html = renderHTML(adapt(answer, catalog), catalog, template);
        reportPhase('rendering the PDF', attempt + 1);
        htmlPath = join(stage, fileStem + '.html');
        pdfPath = join(stage, fileStem + '.pdf');
        writeFileSync(htmlPath, html);
        const rendered = spawnSync(
          process.execPath,
          [join(root, 'src', 'cvgen', 'generate-pdf.mjs'), htmlPath, pdfPath, '--format=letter'],
          { encoding: 'utf8', windowsHide: true },
        );
        if (rendered.status !== 0)
          throw new Error('PDF render failed: ' + (rendered.stderr || rendered.stdout));
        const pageMatch = /📊 Pages: (\d+)/.exec(rendered.stdout || '');
        const pageCount = pageMatch ? Number(pageMatch[1]) : null;
        if (pageCount !== null && pageCount > config.max_pages)
          throw new CVPageBudgetError(pageCount, config.max_pages, answer);
        break;
      } catch (e) {
        if (attempt === config.max_repairs) throw e;
        if (e instanceof CVWorksheetValidationError) {
          // The next repair merges into the answer that just failed (normalized).
          base = e.answer;
          pending = e.issues;
        }
        const repair = repairFor(e, raw, base);
        repairs.push(repair ? repair.kind : 'rerun');
        if (!repair) continue;
        const next = 'repair-' + (attempt + 1) + '-';
        writeFileSync(
          join(work, next + 'error.json'),
          JSON.stringify(repair.error, null, 2) + '\n',
        );
        input = repair.prompt;
        writeFileSync(join(work, next + 'context.md'), input);
      }
    }
    mkdirSync(selection.out, { recursive: true });
    copyFileSync(pdfPath, join(selection.out, fileStem + '.pdf'));
    writeFileSync(
      join(work, 'draft-run.json'),
      JSON.stringify(
        {
          run_id: runId,
          provider,
          status: 'rendered-needs-visual-review',
          validation_repair_attempted: repairs.includes('validation'),
          attempts: repairs.length + 1,
          repairs,
          run_directory: work,
          prompt: promptPath,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify(
        {
          status: 'rendered-needs-visual-review',
          pdf: join(selection.out, fileStem + '.pdf'),
          validation_repair_attempted: repairs.includes('validation'),
          attempts: repairs.length + 1,
          repairs,
          run_directory: work,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    writeFileSync(
      join(work, 'draft-run.json'),
      JSON.stringify(
        {
          run_id: runId,
          status: 'failed',
          validation_repair_attempted: repairs.includes('validation'),
          attempts: repairs.length + 1,
          repairs,
          error: e.message,
          run_directory: work,
        },
        null,
        2,
      ) + '\n',
    );
    console.error(e.message + '\nPreserved run: ' + work);
    process.exitCode = 1;
  }
});
