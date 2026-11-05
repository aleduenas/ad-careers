# src/test-all.mjs

**Kind:** test
**Purpose:** The repository-wide test harness. It syntax-checks every `.mjs` under `src/`, runs every discovered `src/**/test-*.mjs`, builds the dashboard into a temp file, verifies required system files exist and private files are untracked, scans for absolute user paths, checks per-file documentation coverage, `AGENTS.md` for required sections and validates the package version. It never touches the personal database or private artifacts: integration tests that need `TEST_DATABASE_URL` report `SKIPPED` and count as warnings.

## Run
- `node src/test-all.mjs` (alias `npm test`): everything
- `node src/test-all.mjs --quick`: skip the Go build (used by `.github/workflows/test.yml`)
Exit 1 if any check fails; 0 with a warning banner if only skips occurred. Requires `git`, `node`, and `go` unless `--quick`.

## Reads
- `src/**/*.mjs` (recursive discovery)
- `AGENTS.md`, `package.json`
- `git ls-files` for the private-file list and `git grep --untracked` over source/documentation files for hard-coded user-home paths
- Existence of the system files listed in `systemFiles` (documentation index and guides, example configs, key launchers, templates, `infra/sql/schema.sql`, `infra/docker/compose.yml`, all `llm/prompts/eval/*.md`, CV worksheet/repair prompts, runtime prompts)

## Writes
- `<os tmpdir>/career-dashboard-test.exe` (throwaway build output; the shipped `dashboard/dashboard.exe` is not rebuilt)
- Whatever the discovered tests write to their own temp folders (`logs/tests/`, OS tmpdir)

## Imports
- none (Node built-ins only; child scripts are executed, not imported)

## Used by
- `package.json` script `test`
- `.github/workflows/test.yml` (`--quick`)

## Notes
- Test discovery is by filename pattern (`/test-[^/]+\.mjs$/`, excluding this file), so adding `test-foo.mjs` anywhere under `src/` enrols it automatically. Each test has a 60 s timeout and must exit 0; output containing `SKIPPED` downgrades a pass to a warning. Failed test subprocesses print their diagnostic output before the summary.
- Private files asserted untracked: `config/profile.yml`, `config/profile.md`, `config/portals.yml`, `config/cv.md`, `config/cv-guidance.md`, `llm/compacted/cv-compact.md`, `llm/compacted/candidate-targeting.md`, `llm/prompts/cvgen/writing-style-guide.txt`.
- Section 6 checks documentation for source/configuration files under `src/`, `dashboard/`, `infra/`, `llm/prompts/`, `config/examples/` and `.github/workflows/`. JSON examples are included. The final extension is replaced by `.md`; private style inputs and generated logs are excluded.
