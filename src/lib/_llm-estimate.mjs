// Estimates token usage for past CV and cover-letter drafting runs that kept no usage (D093).
// Pure planning over the run folders: it reads file sizes, modification times and draft-run.json
// only, never file contents beyond the job URL line of job-description.md, and writes nothing.
// Rows come out in recordCall's shape with source 'estimate'.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logRefOf } from './_llm-usage.mjs';

// One documented object holds every calibration constant (measured 2026-11-12).
// Runs before this date (the CV drafter fix; first-call time fell from about 45 s to 12-28 s) are
// computed and reported but never stored. Overridable with --since=YYYY-MM-DD.
export const DEFAULT_SINCE = '2026-11-06';

export const ESTIMATE_CONSTANTS = {
  // Sizes are file bytes, used as the character count.
  claude: {
    // input tokens (uncached + cache write + cache read) per prompt character, measured 0.361-0.367
    inputTokensPerChar: 0.364,
    // visible output tokens per response character, measured 0.36-0.41
    visibleTokensPerChar: 0.39,
    // total output tokens (thinking included) per second of call duration, by model
    outputTokensPerSecond: { 'claude-sonnet-5': 115, 'claude-sonnet-5-5': 158 },
    // How the input total splits, from measured rows of the same model (the lead's total ratio is
    // unchanged; the split only lets a price table apply the right per-kind price).
    inputSplit: {
      'claude-sonnet-5': { uncached: 0.3977, cacheWrite: 0.6023 },
      'claude-sonnet-5-5': { uncached: 0, cacheWrite: 1 },
    },
    defaultModel: 'claude-sonnet-5',
    // Plain method used only for the dry-run comparison: thinking = 0.58 x visible output.
    plainThinkingRatio: 0.58,
  },
  // Codex has one measured call (a letter: 23,718 input tokens of 58,303 prompt characters, 9,216
  // cached, 396 output tokens of which 43 reasoning, in 17.3 s). Its ratios are used as measured.
  codex: {
    model: 'gpt-6.1-sol',
    inputTokensPerChar: 0.4068,
    cachedShare: 0.3886,
    outputTokensPerSecond: 22.8,
    reasoningShare: 0.1086,
    // visible output tokens per response character (353 visible tokens over 2,069 characters);
    // used only by the dry-run plain-ratio comparison.
    visibleTokensPerChar: 0.1706,
  },
  // Letter runs record no provider; they are assumed to be Codex (the configured letter default).
  letterProvider: 'codex',
  // Drafting wrote no usage before this instant; runs near a measured row are skipped.
  measuredWindowBeforeMs: 10000,
  measuredWindowAfterMs: 120000,
};

const FOLDER_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;
const size = path => statSync(path).size;
const mtime = path => statSync(path).mtimeMs;

export function folderTime(name) {
  const m = FOLDER_TIME.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

// The calls a run folder holds: { prompt, response } absolute paths in call order. Current layout:
// cli-context.md with response.json (CV) or response.md (letter), then repair-N-context.md with
// repair-N-response.json. Oldest layout: draft-prompt.txt / draft-response.txt and
// repair-N-prompt.txt / repair-N-response.txt.
export function callFiles(dir) {
  const has = name => existsSync(join(dir, name));
  const calls = [];
  const first = [
    ['cli-context.md', 'response.json'],
    ['cli-context.md', 'response.md'],
    ['draft-prompt.txt', 'draft-response.txt'],
  ].find(([, response]) => has(response));
  if (first) {
    const prompt = has(first[0]) ? first[0] : null;
    if (prompt) calls.push({ prompt: join(dir, prompt), response: join(dir, first[1]) });
  }
  for (let n = 1; n < 50; n++) {
    const pair = [
      [`repair-${n}-context.md`, `repair-${n}-response.json`],
      [`repair-${n}-prompt.txt`, `repair-${n}-response.txt`],
    ].find(([, response]) => has(response));
    if (!pair) break;
    // A rerun repeats the first prompt, so a missing repair prompt falls back to it.
    const prompt = has(pair[0]) ? join(dir, pair[0]) : (calls[0]?.prompt ?? null);
    if (prompt) calls.push({ prompt, response: join(dir, pair[1]), hasOwnPrompt: has(pair[0]) });
  }
  return calls;
}

function jobUrl(dir) {
  const path = join(dir, 'job-description.md');
  if (!existsSync(path)) return null;
  const head = readFileSync(path, 'utf8').split(/\r?\n/).slice(0, 12);
  if (head[0]?.trim() !== '---') return null;
  for (const line of head.slice(1)) {
    if (line.trim() === '---') break;
    const m = /^url:\s*(\S+)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

function nearestModel(at, claudeModels) {
  let best = null;
  for (const m of claudeModels) {
    const gap = Math.abs(m.at - at);
    if (!best || gap < best.gap) best = { model: m.model, gap };
  }
  return best?.model ?? null;
}

// Estimates one call. Returns the usage record and the plain-ratio output for comparison.
export function estimateCall({ provider, model, promptChars, responseChars, seconds }) {
  const k = ESTIMATE_CONSTANTS;
  if (provider === 'codex') {
    const c = k.codex;
    const input = Math.round(promptChars * c.inputTokensPerChar);
    const cached = Math.round(input * c.cachedShare);
    const output = Math.round(seconds * c.outputTokensPerSecond);
    const visible = Math.round(responseChars * c.visibleTokensPerChar);
    return {
      usage: {
        inputTokens: input - cached,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        outputTokens: output,
        reasoningTokens: Math.round(output * c.reasoningShare),
        reportedCostUsd: null,
      },
      plainOutput: Math.round(visible * (1 + k.claude.plainThinkingRatio)),
    };
  }
  const c = k.claude;
  const input = Math.round(promptChars * c.inputTokensPerChar);
  const split = c.inputSplit[model] ?? c.inputSplit[c.defaultModel];
  const write = Math.round(input * split.cacheWrite);
  const visible = Math.round(responseChars * c.visibleTokensPerChar);
  const speed = c.outputTokensPerSecond[model] ?? c.outputTokensPerSecond[c.defaultModel];
  const output = Math.max(visible, Math.round(seconds * speed));
  return {
    usage: {
      inputTokens: input - write,
      cacheReadTokens: 0,
      cacheWriteTokens: write,
      outputTokens: output,
      reasoningTokens: output - visible,
      reportedCostUsd: null,
    },
    plainOutput: Math.round(visible * (1 + c.plainThinkingRatio)),
  };
}

// measured: [{ logRef, calledAt }] non-estimate cv/coverLetter rows; claudeModels: [{ model, at }];
// jobsByUrl: Map url -> [job ids]. Returns { rows, plain, skipped, assumptions }.
export function planEstimates(
  root,
  { measured = [], claudeModels = [], jobsByUrl = new Map(), existingRefs = new Set() } = {},
) {
  const base = join(root, 'logs', 'drafting', 'runs');
  const k = ESTIMATE_CONSTANTS;
  const rows = [];
  const plain = [];
  const skipped = { noResponse: 0, measured: 0, alreadyEstimated: 0 };
  const assumptions = new Set();
  const measuredAt = measured.map(m => Date.parse(m.calledAt)).filter(Number.isFinite);
  if (!existsSync(base)) return { rows, plain, skipped, assumptions: [] };
  for (const name of readdirSync(base).sort()) {
    const dir = join(base, name);
    if (!statSync(dir).isDirectory()) continue;
    const calls = callFiles(dir);
    if (!calls.length) {
      skipped.noResponse++;
      continue;
    }
    const isLetter = name.includes('-letter-');
    const start = folderTime(name) ?? mtime(calls[0].prompt);
    const end = Math.max(...calls.map(c => mtime(c.response)));
    const prefix = logRefOf(root, dir) + '/';
    if (
      measured.some(m => m.logRef?.startsWith(prefix)) ||
      measuredAt.some(
        t => t >= start - k.measuredWindowBeforeMs && t <= end + k.measuredWindowAfterMs,
      )
    ) {
      skipped.measured++;
      continue;
    }
    let provider;
    const runFile = join(dir, 'draft-run.json');
    if (isLetter) {
      provider = k.letterProvider;
      assumptions.add('letter runs record no provider; assumed ' + k.letterProvider);
    } else {
      try {
        provider = JSON.parse(readFileSync(runFile, 'utf8')).provider;
      } catch {
        provider = null;
      }
      if (provider !== 'claude' && provider !== 'codex') {
        provider = 'claude';
        assumptions.add('CV runs without draft-run.json assumed claude');
      }
    }
    const url = jobUrl(dir);
    const ids = url ? (jobsByUrl.get(url) ?? []) : [];
    const jobId = ids.length === 1 ? ids[0] : null;
    let previousEnd = null;
    for (const call of calls) {
      const logRef = logRefOf(root, call.response);
      const responseAt = mtime(call.response);
      // A call starts when its prompt file was written; a rerun without its own prompt starts
      // when the previous call ended.
      const startedAt =
        call.hasOwnPrompt === false ? (previousEnd ?? mtime(call.prompt)) : mtime(call.prompt);
      previousEnd = responseAt;
      if (existingRefs.has(logRef)) {
        skipped.alreadyEstimated++;
        continue;
      }
      const model =
        provider === 'codex'
          ? k.codex.model
          : (nearestModel(responseAt, claudeModels) ?? k.claude.defaultModel);
      if (provider === 'claude' && !k.claude.outputTokensPerSecond[model])
        assumptions.add('model ' + model + ' has no speed sample; claude-sonnet-5 constants used');
      const seconds = Math.max(0, (responseAt - startedAt) / 1000);
      const { usage, plainOutput } = estimateCall({
        provider,
        model,
        promptChars: size(call.prompt),
        responseChars: size(call.response),
        seconds,
      });
      rows.push({
        provider,
        model,
        function: isLetter ? 'coverLetter' : 'cv',
        jobId,
        usage,
        calledAt: new Date(responseAt).toISOString(),
        durationMs: Math.round(seconds * 1000),
        source: 'estimate',
        logRef,
        runFolder: name,
        runDate: new Date(start).toISOString().slice(0, 10),
      });
      plain.push({ provider, plainOutput });
    }
  }
  return { rows, plain, skipped, assumptions: [...assumptions].sort() };
}

const total = u => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens;

// Counts and token totals by month and function, plus the plain-ratio output for comparison.
export function summarizeEstimates(rows, plain) {
  const table = {};
  const seen = {};
  rows.forEach((r, i) => {
    const key = r.calledAt.slice(0, 7) + ' / ' + r.function + ' / ' + r.provider;
    const t = (table[key] ??= {
      runs: 0,
      calls: 0,
      inputTokens: 0,
      visibleOutputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      plainRatioOutputTokens: 0,
    });
    t.calls++;
    if (!(seen[key] ??= new Set()).has(r.runFolder)) {
      seen[key].add(r.runFolder);
      t.runs++;
    }
    t.visibleOutputTokens += r.usage.outputTokens - r.usage.reasoningTokens;
    t.inputTokens += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
    t.outputTokens += r.usage.outputTokens;
    t.thinkingTokens += r.usage.reasoningTokens;
    t.totalTokens += total(r.usage);
    t.plainRatioOutputTokens += plain[i].plainOutput;
  });
  return table;
}
