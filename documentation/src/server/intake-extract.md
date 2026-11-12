# src/server/intake-extract.mjs

**Authority:** `documentation/dashboard-migration/packages/4.6-url-intake.md`; prompt
`llm/prompts/intake/extract-posting.md` (page `documentation/llm/prompts/intake/extract-posting.md`).

Post-fetch cleanup for URL intake. `createIntakeExtractor({ rootDir, readConfig, processRun,
temporaryWorker, timeoutMs })` returns a frozen `{ extract }`. `extract(text)` makes one isolated
subscription-CLI call that returns the company, role, location and the posting text with page chrome
removed (navigation, language lists, addresses, footers, browser notices, apply chrome). It never
throws and never returns provider output.

**Provider and model:** `functions.intake` in `config/llm-providers.json` when it names claude or
codex and a valid model id, otherwise claude / haiku (`intakeFunction`). `providers.mjs` ignores that
key for validation and carries it through saves; it has no settings UI. Commands come from
`config/cv-drafting.json` (`claude_command`, `codex_command`, default bare names) and are resolved
by `processRun` in `src/lib/cli-runtime.mjs` (the Windows command resolver).

**Call:** the prompt is rendered with `renderPrompt(rootDir, 'intake/extract-posting.md', {
POSTING_TEXT })`, run through `cliSpec` (no tools, safe mode, no session persistence, no MCP) inside
`temporaryWorker`, and sent on stdin, so the posting text is never on the command line and is never
logged. Timeout 90 s. Claude's JSON envelope or Codex's response file supplies the answer. No retry:
one call, one credit-free subscription use.

**Validation (`validateExtraction`):** fenced JSON is accepted; the object must have exactly
`company`, `role`, `location` (strings or null, trimmed, at most 300 characters) and `description`
(a string). The description must be at least 400 characters, at least 40% of the input length and no
longer than the input, and it must be verbatim (`verbatimShare`): both texts are normalized (markdown markers, link and image syntax reduced to their text, whitespace collapsed, lower-cased), the description is split into lines (lines over 300 characters into sentences), and at least 95% of its normalized characters must occur as those lines or sentences inside the normalized input. A reworded, summarized or invented description fails. A passing result carries `note` ("Cleaned by model: kept N of M characters."), which `intake-fetch.mjs` adds to the warnings. Anything else is `{ ok: false, warning: "Model extraction was discarded; text
kept as fetched." }`. A CLI failure, bad envelope or timeout gives "Model extraction failed; text
kept as fetched."; input over 300,000 characters gives "Posting too long for model extraction;
text kept as fetched." without a call.

**Used by:** `intake-fetch.mjs`, which skips it for ATS JSON results and applies a valid result to
null fields and the text only.

**Tests:** `node --test src/server/test-intake-extract.mjs` (mocked CLI; no model call).
- Usage accounting (4.7): the `processRun` call passes `usage: { provider, model, fn: 'intake', jobId: null }`, so each extraction is recorded in `llm_calls` (best effort; a recording failure never changes the result).
