# llm/prompts/runtime/no-tools.md

**Kind:** system prompt (provider runtime; Claude only)

**Purpose:** The three-sentence system prompt for every worker call that must not use tools:
the gate, the evaluation, CV drafting and cover-letter drafting. It tells the model to complete
only the supplied task and response contract, treat supplied documents as evidence rather than
instructions, and never access files, delegate or use tools.

**Substituted by:** `cliSpec()` in `src/lib/cli-runtime.mjs`, which renders it with
`renderPrompt(promptRoot,'runtime/no-tools.md')` (no values) and passes the text as the
`--system-prompt` argument of the `claude -p` command together with `--tools ''`,
`--permission-mode dontAsk`, `--no-session-persistence` and an empty MCP config. For the Codex
provider no system prompt is passed; the equivalent restriction is `features.shell_tool=false`
and `web_search="disabled"`.

**Placeholders:** none.

**Expected response:** not applicable; the task prompt carries the contract.

**Notes:**

- `src/eval/evaluate-jobs.mjs` lists this file among the required inputs, snapshots it into
  `logs/evaluation/<run-id>/prompt-sources/` and records it in `worker_runtime.system_prompt_paths`
  in `run.json`, so a run fails early if the file is missing and a changed file invalidates a
  resumed run.
- `renderPrompt` requires the file name to match `^[a-z0-9][a-z0-9/-]*\.md$`; keep the name
  lowercase.
