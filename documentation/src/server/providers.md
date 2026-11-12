# src/server/providers.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_PROVIDERS_CONTRACT.md`.

Subscription provider settings for the browser dashboard.
`createProvidersService({ rootDir, fs, checkLogin, temporaryWorker, now, checkTimeoutMs })` returns
a frozen `{ get, put, checkReadiness, resolve }`; every adapter can be injected, and tests use a
temporary root and a fake login runner (never a real provider call).

**Settings file:** private `config/llm-providers.json`, version 1, naming a `provider` (`claude` or
`codex`) and a `model` (non-empty, at most 80 characters, no control characters) for `evaluation`,
`companyResearch`, `cv` and `coverLetter`. The `revision` is the SHA-256 of the file's bytes. A
file that is not valid version 1 with all four functions (or over 64 KB) is 503
`SETTINGS_UNREADABLE`; its contents are never echoed and it is never overwritten implicitly.

**Legacy derivation (read-only):** with no file, the effective values come from
`config/evaluation-cli.json` (`default_provider`, `<provider>_model`, `<provider>_research_model`;
launcher defaults claude/sonnet, research haiku, codex gpt-6.1-sol, research gpt-6-luna) for evaluation and company research,
and `config/cv-drafting.json` (`default_provider`, `<provider>_model`, an empty value falling back
to sonnet or gpt-6.1-sol) for the CV and cover letter. They are reported with `source: 'legacy'` and
revision `'legacy'`. Missing, broken or non-object launcher configs are treated as empty.
Reading never creates or alters a file.

**put(function, { expectedRevision, provider, model })** validates the function name, a revision
(`'legacy'` or 64 hex characters), the provider key and the model (400 with `fields`). Under an
in-process lock it compares the revision with the current one (409 `SETTINGS_CONFLICT` with the
current document in `error.current`), replaces the one function, and rewrites all four atomically
(temp file plus rename, mode 0600). The first save therefore materializes every function. A failed
write is a generic 500 `SETTINGS_WRITE_FAILED`, leaves no temporary file and keeps the old file.
Executable paths stay in the launcher configs. An optional `functions.intake` entry (`{provider, model}`, read by `intake-extract.mjs`) is not validated or shown here, has no UI, and is carried through every save untouched; without it URL intake uses claude / haiku.

**checkReadiness()** runs the existing `checkLogin` for both providers through `temporaryWorker`
(the commands come from `config/cv-drafting.json`), each bounded to 20 s, concurrently, and never
calls a model. States are `ready`, `notLoggedIn` (the fixed login messages) and `unavailable` (a
fixed "command could not be run" or "took too long" message); raw errors and paths are never
returned. The last result is held in memory per provider (`unknown` before the first check) and
overlapping requests share one check.

**resolve(action)** returns the effective selection for the run service: `{evaluation,
companyResearch}` for `evaluate`, `{cv}`, `{coverLetter}`, and `{}` for anything else.

**Tests:** `node --test src/server/test-providers.mjs`.

**BOM:** a leading UTF-8 byte-order mark in `config/llm-providers.json` (or a launcher config) is
removed before parsing; the revision stays the hash of the raw text. A file that still does not
parse is `SETTINGS_UNREADABLE`.

## Model lists (D066)

`get` also returns `models: {claude, codex}`, the model ids the UI offers. Defaults are
`DEFAULT_MODELS` (claude: sonnet, opus, haiku; codex: gpt-6.1-sol, gpt-6-luna). A settings file may carry an
optional `models` object; a provider's entry replaces its default only when it is an array of 1 to
50 valid model ids, otherwise that provider keeps the defaults and the read does not fail. A
function's configured model outside the list is returned unchanged. Saves rewrite the file with
the original `models` value intact. PUT validation is unchanged. A command that cannot be spawned
(ENOENT) maps to readiness `unavailable` with the fixed message, covered by the readiness test.
