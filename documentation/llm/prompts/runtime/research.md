# llm/prompts/runtime/research.md

**Kind:** system prompt (provider runtime; Claude only)

**Purpose:** The system prompt for the two research workers (company research and market
research). Identical to `no-tools.md` except that web search and page retrieval are allowed,
and only for cited evidence.

**Substituted by:** `cliSpec()` in `src/lib/cli-runtime.mjs` when called with
`{research: true}`: rendered with `renderPrompt(promptRoot,'runtime/research.md')` and passed
as `--system-prompt`, with `--tools WebSearch,WebFetch` and `--allowedTools WebSearch,WebFetch`.
`invoke()` in `src/eval/_evaluation-cli.mjs` enables research only on the first attempt of a
phase; repair attempts run without tools. For Codex the equivalent is `web_search="live"`.

**Placeholders:** none.

**Expected response:** not applicable.

**Notes:**

- Listed as a required input by `src/eval/evaluate-jobs.mjs`, snapshotted into the run's
  `prompt-sources/` folder and named in `worker_runtime.system_prompt_paths`.
- The research budget (four searches, four fetches) is stated in the task prompts
  (`company-research.md`, `market-research.md`), not here.
- Not used by the cvgen scripts; drafting never researches.
