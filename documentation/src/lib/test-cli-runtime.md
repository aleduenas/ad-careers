# src/lib/test-cli-runtime.mjs

**Kind:** test
**Purpose:** Unit test for `src/lib/cli-runtime.mjs`. It checks scratch-folder confinement and cleanup, environment scrubbing, the exact provider argument lists (safe mode, disabled tools, read-only Codex sandbox, explicit model), literal stdin passing and the timeout path, all without launching a real CLI.

## Run
`node src/lib/test-cli-runtime.mjs` with no arguments. No database, Docker or model CLI needed; the only child process spawned is `node -e`. Discovered and run automatically by `src/test-all.mjs`.

## Reads
- none from the repository (works in a fresh temp folder)

## Writes
- `<os tmpdir>/career-runtime-test-<random>/` (repo and drafting fixtures), removed in `finally` after a guard that the path really is under the OS temp directory

## Imports
- `src/lib/cli-runtime.mjs` (`subscriptionEnv`, `cliSpec`, `processRun`, `draftingRoot`, `temporaryWorker`)

## Used by
- `src/test-all.mjs` (section 2, discovered by the `test-*.mjs` pattern)

## Notes
- Asserts that neither provider's args contain the string `dangerously`, that Claude does not receive `--bare`, and that `cliSpec` throws for an unknown provider and for Codex without `codex_model`.
- The timeout check uses a 100 ms limit on a 20 s `setTimeout` child and expects the rejection message to match `/timed out/`.
- Prints one summary line on success; any assertion failure exits non-zero.

The timeout fixture immediately removes its temporary working directory after rejection, exercising the requirement to await child closure before cleanup.
