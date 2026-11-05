# src/lib/cli-runtime.mjs

**Kind:** shared module
**Purpose:** The isolated runtime for spawning a Claude or Codex CLI as a subscription-login worker. It builds the provider command line (`cliSpec`), scrubs API-key and nested-session variables from the environment (`subscriptionEnv`), runs the process with a hard timeout and output cap (`processRun`), confines scratch folders below `logs/` (`draftingRoot`, `temporaryWorker`) and verifies the login is a subscription, not API billing (`checkLogin`). CV drafting, cover-letter drafting and evaluation all share it.

## Run
Not runnable; imported by other modules.

## Reads
- `llm/prompts/runtime/no-tools.md` or `llm/prompts/runtime/research.md` (Claude system prompt, via `renderPrompt`)
- `process.env` (copied and filtered)
- Provider config object passed by the caller: `claude_command`, `claude_model`, `claude_effort`, `codex_command`, `codex_model` (from `config/cv-drafting.json` or the evaluation config)
- `claude auth status` / `codex login status` output (`checkLogin`)

## Writes
- `logs/workers/career-cv-worker-<random>/` temporary folders, removed after `temporaryWorker` finishes (success or failure)

## Imports
- `src/lib/_prompt-templates.mjs` (`renderPrompt`)
- `src/lib/root.mjs` (prompt root)

## Used by
- `src/cvgen/draft-cv.mjs`, `src/cvgen/draft-cover-letter.mjs` (`draftingRoot`, `temporaryWorker`, `childOf`, `cliSpec`, `processRun`, `checkLogin`)
- `src/cvgen/publish-cover-letter.mjs` (`childOf`)
- `src/eval/evaluate-jobs.mjs`, `src/eval/_evaluation-cli.mjs`
- `src/lib/test-cli-runtime.mjs`

## Notes
- `subscriptionEnv` deletes `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_*` and `CLAUDECODE`; `CLAUDE_CODE_OAUTH_TOKEN` is kept.
- Claude args: `-p --safe-mode --output-format json --model ... [--effort ...] --tools '' --permission-mode dontAsk --disable-slash-commands --no-session-persistence --strict-mcp-config --mcp-config {"mcpServers":{}} --system-prompt <rendered>`; with `{research:true}` the tools become `WebSearch,WebFetch` (also `--allowedTools`) and the research system prompt is used. Codex args: `exec --ignore-user-config --skip-git-repo-check --ephemeral --sandbox read-only`, shell and unified exec disabled, `project_doc_max_bytes=0`, `web_search` live or disabled, `--output-last-message <file>`, prompt on stdin (`-`). An explicit `codex_model` is mandatory.
- `processRun` never uses a shell; stdin gets the prompt literally. Default timeout 600 s; on timeout it kills the process tree (`taskkill /T /F` on Windows) and rejects with "CLI timed out". stdout or stderr above 4 MB kills the child.
- `draftingRoot(root, configured)` requires the target to be under `<root>/logs` and walks up existing ancestors to reject symlink escapes. `temporaryWorker` re-checks the scratch path before `rmSync`.
- `checkLogin` requires Claude `authMethod === 'claude.ai'` or Codex output containing "using ChatGPT"; otherwise it throws with instructions to log in.

On timeout the process tree is killed, then the promise rejects on the child close event. Waiting for closure releases Windows handles before temporary worker cleanup.
