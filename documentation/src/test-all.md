# src/test-all.mjs

**Kind:** test
**Purpose:** The repository-wide test harness. It syntax-checks every `.mjs` under `src/` and maintained `web/`, runs discovered `test-*.mjs` files, performs web type/build checks, builds the Go dashboard into a temp file, verifies required system files exist and private files are untracked, scans for absolute user paths, checks per-file documentation coverage, checks required `AGENTS.md` sections and validates the package version. The quick run generates API types and runs strict TypeScript checking once. The full run requires `web/index.html` and runs the web build (which includes typechecking); a missing production entrypoint is a failure. It never touches the personal database or private artifacts: integration tests that need `TEST_DATABASE_URL` report `SKIPPED` and count as warnings.

## Run
- `node src/test-all.mjs` (alias `npm test`): all checks, required web build, and the Go build
- `node src/test-all.mjs --quick`: web API type generation + strict typecheck; skip both production builds (used by `.github/workflows/test.yml`)
Exit 1 if any check fails; 0 with a warning banner if only skips occurred. Requires `git`, Node.js 24+, npm and Go unless `--quick`.

A failed retained Go build prints its compiler/process diagnostics before the summary, so an
environment/cache failure can be distinguished from a source failure.

## Reads
- `src/**/*.mjs` and maintained `web/` `.mjs` files (recursive discovery)
- Maintained `web/` HTML, CSS, JSON, JS/JSX and TS/TSX files for documentation coverage
- `AGENTS.md`, `package.json`
- `git ls-files` for the private-file list and `git grep --untracked` over source/documentation files for hard-coded user-home paths
- Existence of the system files listed in `systemFiles` (documentation index and guides, example configs, key launchers, templates, `web/index.html`, `infra/sql/schema.sql`, `infra/docker/compose.yml`, all `llm/prompts/eval/*.md`, CV worksheet/repair prompts, runtime prompts)

## Writes
- `web/src/generated/api.d.ts` through `web:typecheck` (ignored generated API declarations)
- `web/dist/` if the full web build runs (ignored build output)
- `<os tmpdir>/career-dashboard-test.exe` (throwaway Go build output; the shipped `dashboard/dashboard.exe` is not rebuilt)
- Whatever the discovered tests write to their own temp folders (`logs/tests/`, OS tmpdir)

## Imports
- none (Node built-ins only; child scripts are executed, not imported)

## Used by
- `package.json` script `test`
- `.github/workflows/test.yml` (`--quick`)

## Notes
- Test discovery is by filename pattern (`/test-[^/]+\.mjs$/`, excluding this file), so adding `test-foo.mjs` anywhere under `src/` enrols it automatically. Each test has a 60 s timeout and must exit 0; output containing `SKIPPED` downgrades a pass to a warning. Failed test subprocesses print their diagnostic output before the summary.
- Private files asserted untracked: `config/profile.yml`, `config/profile.md`, `config/portals.yml`, `config/cv.md`, `config/cv-guidance.md`, `llm/compacted/cv-compact.md`, `llm/compacted/candidate-targeting.md`, `llm/prompts/cvgen/writing-style-guide.txt`.
- Section 7 checks documentation for source/configuration files under `src/`, `web/`, `dashboard/`, `infra/`, `llm/prompts/`, `config/examples/` and `.github/workflows/`. Web tool caches, `node_modules`, generated API declarations and `web/dist/` are excluded. JSON examples are included. The final extension is replaced by `.md`; private style inputs and generated logs are excluded.
- Web package scripts are invoked by their fixed names. Windows uses `cmd.exe` only for the literal npm script command needed by npm's `.cmd` shim; no user-provided shell text is executed.
