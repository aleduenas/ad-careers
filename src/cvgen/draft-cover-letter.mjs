#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { logTokenUsage } from '../lib/_token-debug.mjs';
import {
  draftingRoot,
  temporaryWorker,
  childOf,
  cliSpec,
  processRun,
  checkLogin,
} from '../lib/cli-runtime.mjs';
import { resolveJob, wrapCoverLetter, candidateName, withOutputLock } from './_cv-drafting.mjs';
import { reportPhase } from '../lib/_task-status.mjs';
import { renderPrompt } from '../lib/_prompt-templates.mjs';

import { root } from '../lib/root.mjs';
const options = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const n = a.indexOf('=');
    return n < 0 ? [a.slice(2), true] : [a.slice(2, n), a.slice(n + 1)];
  }),
);
const config = {
    max_repairs: 2,
    ...JSON.parse(readFileSync(join(root, 'config/cv-drafting.json'), 'utf8')),
  },
  provider = options.provider || config.default_provider;
if (!Number.isInteger(config.max_repairs) || config.max_repairs < 0 || config.max_repairs > 3)
  throw new Error('max_repairs must be 0–3');
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
const source = readFileSync(
    join(root, 'llm', 'prompts', 'cvgen', 'cover-letter-worksheet.md'),
    'utf8',
  ),
  stylePath = join(root, 'llm', 'prompts', 'cvgen', 'writing-style-guide.txt'),
  writingStyle = readFileSync(stylePath, 'utf8'),
  cv = readFileSync(join(root, 'llm', 'compacted', 'cv-compact.md'), 'utf8'),
  jd = selection.jdContent ?? readFileSync(selection.jd, 'utf8'),
  samples = readFileSync(
    join(root, 'llm', 'prompts', 'cvgen', 'cover-letter-paragraph-worksheet.txt'),
    'utf8',
  );
const context = renderPrompt(root, 'cvgen/cover-letter-worksheet.md', {
  JOB_DESCRIPTION: jd.trimEnd(),
  CANDIDATE_CV: cv.trimEnd(),
  COVER_LETTER_SAMPLES: samples.trimEnd(),
  WRITING_STYLE: writingStyle.trimEnd(),
});
const archive = draftingRoot(root, config.drafting_root),
  run = join(
    archive,
    'runs',
    new Date().toISOString().replace(/[:.]/g, '-') + '-letter-' + randomUUID().slice(0, 8),
  );
if (options['dry-run']) {
  console.log(
    JSON.stringify(
      {
        provider,
        run_directory: run,
        prompt: 'llm/prompts/cvgen/cover-letter-worksheet.md',
        ...selection,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (!options['prepare-only']) await temporaryWorker(root, cwd => checkLogin(provider, config, cwd));
mkdirSync(run, { recursive: true });
writeFileSync(join(run, 'cv.md'), cv);
writeFileSync(join(run, 'job-description.md'), jd);
writeFileSync(join(run, 'cover-letter-samples.md'), samples);
copyFileSync(
  join(root, 'llm', 'prompts', 'cvgen', 'cover-letter-worksheet.md'),
  join(run, 'worksheet.md'),
);
copyFileSync(stylePath, join(run, 'writing-style-guide.txt'));
writeFileSync(join(run, 'cli-context.md'), context);
if (options['prepare-only']) {
  console.log(JSON.stringify({ status: 'prepared', run_directory: run }, null, 2));
  process.exit(0);
}
const runId = run.split(/[\\/]/).pop();
await withOutputLock(archive, selection.out, 'letter', runId, async () => {
  // The letter is prose, not a worksheet, so a failure here is always a CLI or
  // transport failure with nothing to correct: the same input is re-run, up to
  // config.max_repairs times after the first call.
  const invoke = async (attempt, stderrName) =>
    temporaryWorker(root, async cwd => {
      const response = join(cwd, 'response.txt'),
        spec = cliSpec(provider, config, response);
      if (provider === 'codex') spec.args.splice(1, 0, '--json');
      const result = await processRun(spec.command, spec.args, {
        cwd,
        input: context,
        timeout: config.timeout_ms,
      });
      logTokenUsage(root, {
        provider,
        model: config[provider + '_model'],
        workflow: 'cover-letter',
        phase: 'single worksheet (attempt ' + (attempt + 1) + ')',
        runPath: run,
        stdout: result.stdout,
        code: result.code,
      });
      writeFileSync(join(run, stderrName), result.stderr);
      if (result.code !== 0) throw new Error(provider + ' failed: ' + result.stderr);
      if (provider === 'claude') {
        const data = JSON.parse(result.stdout);
        if (data.is_error || typeof data.result !== 'string')
          throw new Error('Claude returned no cover letter');
        return data.result;
      }
      if (!existsSync(response)) throw new Error('Codex returned no cover letter');
      return readFileSync(response, 'utf8');
    });
  let raw,
    attempts = 0;
  for (let attempt = 0; ; attempt++) {
    reportPhase('drafting the cover letter', attempt + 1);
    attempts = attempt + 1;
    try {
      raw = await invoke(
        attempt,
        attempt === 0 ? 'stderr.log' : 'retry-' + attempt + '-stderr.log',
      );
      if (!raw.trim()) throw new Error('Cover-letter worker returned an empty response');
      break;
    } catch (e) {
      if (attempt === config.max_repairs) throw e;
    }
  }
  writeFileSync(join(run, 'response.md'), raw.trim() + '\n');
  mkdirSync(selection.out, { recursive: true });
  writeFileSync(join(selection.out, 'cover-letter.md'), wrapCoverLetter(raw, candidateName(root)));
  console.log(
    JSON.stringify(
      {
        status: 'drafted-needs-review',
        letter: join(selection.out, 'cover-letter.md'),
        attempts,
        run_directory: run,
      },
      null,
      2,
    ),
  );
});
