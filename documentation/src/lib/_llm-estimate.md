# src/lib/_llm-estimate.mjs

**Kind:** shared module (pure planning, no writes)
**Purpose:** Estimates token usage for past CV and cover-letter drafting runs that kept no usage (D093), as `llm_calls` rows with `source = 'estimate'`.

## Run
Not runnable; used by `node src/helpers/import-llm-usage.mjs --estimate-drafting`.

## Reads
- Under `logs/drafting/runs/<run>/`: file sizes and modification times, `draft-run.json` (provider only) and the `url:` line of the `job-description.md` front matter. Nothing else is read and no content is copied anywhere.

## Exports
- `ESTIMATE_CONSTANTS`: the one documented object of calibration constants (measured 2026-11-12). Claude: 0.364 input tokens per prompt character, 0.39 visible output tokens per response character, total output (thinking included) = call seconds times a per-model speed (`claude-sonnet-5` 115, `claude-sonnet-5-5` 158 tokens per second), thinking = max(0, total minus visible). The input total is split into uncached and cache write by the measured share of the same model (sonnet-5: 0.3977 uncached; sonnet-5-5: all cache write); the total ratio is unchanged, the split only lets a price table apply per-kind prices. Codex has one measured letter, so its ratios are used as measured: 0.4068 input tokens per character, 0.3886 of them cached, 22.8 output tokens per second, reasoning 0.1086 of output. File bytes stand in for characters.
- `DEFAULT_SINCE` (`2026-11-06`, the CV drafter fix; first-call time fell from about 45 s to 12-28 s): runs before it are computed and reported by the helper but never stored. Plan rows carry `runFolder` and `runDate` (UTC date of the folder name) for that split; `summarizeEstimates` reports runs, calls, input, visible output, output, thinking and plain-ratio output.
- `callFiles(dir)`: the calls a run folder holds. Current layout `cli-context.md` with `response.json` (CV) or `response.md` (letter), then `repair-N-context.md` with `repair-N-response.json`; oldest layout `draft-prompt.txt` / `draft-response.txt` and `repair-N-prompt.txt` / `repair-N-response.txt`. A repair without its own prompt reuses the first prompt and starts when the previous call ended.
- `estimateCall({ provider, model, promptChars, responseChars, seconds })` returns `{ usage, plainOutput }`; `plainOutput` is the plain-ratio comparison (thinking = 0.58 times visible).
- `planEstimates(root, { measured, claudeModels, jobsByUrl, existingRefs })` returns `{ rows, plain, skipped, assumptions }`; `summarizeEstimates(rows, plain)` totals by month, function and provider; `folderTime(name)`.

## Rules
- One row per call. Function is `coverLetter` when the folder name contains `-letter-`, else `cv`. `called_at` is the response file time; `duration_ms` is response time minus prompt time. `log_ref` is the response file (idempotent), `reported_cost_usd` null.
- Provider: from `draft-run.json`; CV runs without it are assumed Claude; letter runs record no provider and are assumed Codex (the configured letter default). Both are listed under `assumptions` in the report.
- Claude model: the Sonnet model of the measured Claude row nearest in time, default `claude-sonnet-5`; a model without a speed sample uses the `claude-sonnet-5` constants (reported as an assumption). Codex model is the measured letter's model.
- Job id: the run's job URL matches exactly one `jobs.url`; otherwise null.
- Skipped: folders with no response (dry runs), runs that already have a measured row (a `log_ref` under the run folder, or a non-estimate CV or letter row within 10 s before the folder time and 120 s after the last response), and `log_ref`s already estimated.
- Known limits: a letter retry leaves no response file, so a retried letter is one call; the first call's duration includes the login check before the call; characters are bytes.

## Used by
`src/helpers/import-llm-usage.mjs`, `src/lib/test-llm-estimate.mjs`.
