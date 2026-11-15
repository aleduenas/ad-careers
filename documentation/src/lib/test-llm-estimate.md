# src/lib/test-llm-estimate.mjs

**Kind:** test
**Purpose:** Unit test for `src/lib/_llm-estimate.mjs` on fixture run folders in a temporary directory (sizes and mtimes set with `utimesSync`).

## Run
`node src/lib/test-llm-estimate.mjs`. No database needed; discovered by `src/test-all.mjs`.

## Covers
- Calibration arithmetic for Claude (no negative thinking when visible output exceeds duration times speed, input split keeps the measured total) and Codex (the measured letter reproduces 23,718 input tokens and about 395 output tokens).
- A CV run with a repair (durations from file times, job linked by URL, model by nearest measured row), a letter run (assumed Codex), an ambiguous job URL (job null), a dry run without a response (skipped), a run with a measured row in its window and one matched by `log_ref` prefix (both skipped), and the oldest file layout.
- Idempotence: already estimated `log_ref`s are skipped. Assumptions are reported.
