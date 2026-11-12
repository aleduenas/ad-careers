# src/server/runs.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_TASKS_CONTRACT.md` and the
launch rules of the retired Go TUI, which it ports.

Run dispatch for the browser dashboard. `createRunsService({ store, query, spawn, rootDir, now,
isAlive, findJob, intervalMs, onError })` returns `{ dispatch, list, get, log, reconcile, ready,
start, stop }`. The store defaults to `createRunsStore` on the shared pool; every adapter can be
injected, so tests use an in-memory store, a temporary root and synthetic launcher scripts.

**Scan runs:** `dispatch({ action: 'scan', requestKey, dryRun, company? })` (no `jobId`) starts
`node src/scan/scan.mjs [--dry-run] [--company=<name>] --report-json=logs/dashboard/<log_ref>.scan.json`
by argv (the company is one argv element and is limited to 100 characters without control
characters); the selection `{dryRun, company}` is stored on the run and a repeated key replays only
for the same selection. Scans and real intakes share a discovery lock: dispatch holds it for the
check-and-launch, and an already queued or running scan (found through its run row) or an intake in
progress gives 409 `DISCOVERY_BUSY` with `current: {activeRunId}` (null for an intake). `activeScan()`
exposes that check to intake, and job actions are never blocked. `scanReport(id)` returns the parsed
report projected by `projectScanReport`: summary counts (including `missingFullJd`), per-company
status with a redacted, capped reason, and the deferred `missing` postings (http(s) URLs only);
paths, queries and careers URLs stay out, and the route is 404 while the file is absent, corrupt,
oversized or the run is not a scan.

**Provider selection:** with a `resolveSelection(action)` adapter (the app wires
`providers.mjs#resolve`), `evaluate`, `cv` and `letter` runs resolve the saved provider selection
before the insert, store it in `browser_runs.selection` (`{evaluation, companyResearch}`, `{cv}` or
`{coverLetter}`) and pass it to the launcher as single-element flags (`--provider=`, `--model=`,
and for evaluate `--research-provider=`, `--research-model=`). Malformed entries become no flag,
without an adapter the launch is unchanged, and a failing adapter (such as unreadable settings)
stops the dispatch before anything is recorded. A replay never resolves again. The one-run override
from a dispatch dialog is a 3.4 request field and is not part of the request yet.

**Dispatch rules (STAGE3_DISPATCH_CONTRACT.md):** for evaluate, cv, letter and both the request may
carry `selection`, a one-run override with the keys `evaluation` and `companyResearch` (evaluate),
`cv`, `coverLetter` (letter) or `cv` and `coverLetter` (both); each entry is a `{provider,
model}` pair validated like a settings save, anything else is 400 `fields.selection`. The override
is merged over the saved or legacy selection per run, stored in `browser_runs.selection`, passed
as the launcher flags and returned on the run; it never writes the settings file. A replayed key
returns the stored runs and ignores both the override and the rules below. With an `actionsFor`
adapter (the app wires `jobs-detail.mjs#actionsFor`) a dispatch re-checks the prerequisites the
detail route shows for the tasks it would start: a failed one is 409 `PREREQUISITE_FAILED` (the
fixed reason as message, `error.current.actions`), then an already queued or running run for the
same job and action is 409 `RUN_ACTIVE` (`error.current.activeRunId`). Job dispatches are
serialized in-process so concurrent requests cannot both pass the rule. A pair is two grouped runs;
only a missing child is checked and started, and one child failing never cancels the other.
Nothing is recorded when a check or the selection resolution fails.

**dispatch({ action, jobId, requestKey })** accepts `evaluate`, `cv`, `letter` or `both` (other
contract actions are rejected until their packages). It validates every field and rejects extra
ones (400 with `fields`), checks the job exists (404), then per task: a repeated `requestKey`
with the same action and job returns the existing run without spawning (`replayed: true`); any
other use of the key is 409 `REQUEST_KEY_CONFLICT`. Otherwise it inserts `queued` and launches.
`both` makes two independent runs sharing a `groupId`, with keys `<key>:cv` and `<key>:letter`.

**Launch** ports `workflowCommand`/`launchTask`: `node <repo>/src/{eval/evaluate-jobs,
cvgen/draft-cv, cvgen/draft-cover-letter}.mjs --job=<id>` by argv (no shell, no client path),
cwd the repo, `detached` with `windowsHide`, `stdio` to `logs/dashboard/<log_ref>`, environment
`CAREER_TASK_FILE` (a `logs/dashboard/tasks/<name>.json` record, also read by the legacy runs list and
merged so a worker's early report is kept) and `CAREER_RUN_ID`. The pid and start time are
recorded with `start` immediately after the spawn, and the exit observer is attached before that call, so
nothing that can throw runs between a worker existing and being tracked. If the `start` call itself
fails the run stays queued and the failure is reported to `onError`; the worker is still observed. A missing launcher, a throw or an async spawn `error` ends the run
`failed` with `SPAWN_FAILED`. While this server lives it also observes the exit and finishes the
run (`completed`, or `failed` with `EXIT_NONZERO`); the SQL terminal call is once-only, so a
worker's own report wins if it landed first. Workers are never killed or replayed.

**reconcile()** runs on start and every 30 s. A row still `queued` after 5 minutes (a crash between
insert and start, or a failed start call) is finished as interrupted with `QUEUE_STALE`. A running row whose pid is gone is settled from
the worker's own JSON record if that says `completed`/`failed`; otherwise it is passed to
`interruptStale` as dead (`PROCESS_GONE`), and rows older than 24 h become `STALE_24H`. Liveness is
a signal-0 probe plus the recorded start time: when the pid is alive and the platform can say,
`readProcessStartTime` (Windows only: a bounded 4 s `powershell.exe -NoProfile -Command
(Get-Process -Id N).StartTime...` call with an argument array) is compared with `pid_started_at`,
and a difference over 5 s means the pid was recycled and the run counts as gone. Where the start
time cannot be read (other platforms, a PowerShell failure or timeout) it falls back to the plain
signal-0 answer, so a recycled pid is then only caught by the 24 h rule. Nothing is ever killed. `ready()` is true only when `browser_runs` and its functions exist (looked up on the connection's
search path); the session and `GET /ready` both report that as `taskDispatch`.

**log(id, { offset })** returns a bounded (64 KB), line-aligned chunk of the log with `offset`,
`nextOffset`, `size` and `truncated`; without `offset` it returns the tail. Text is passed through
`redactLog`: ANSI and control characters, the repo root and home directory, credentials in URLs,
`Authorization`/Bearer values, `*token/secret/password/key*` assignments, any `NAME=value`
environment line, JSON-quoted values (`{"password":"..."}`), command-line flags (`--token X`,
`--password=X`), `session` keys, a bare `password X` in prose, JWTs, vendor-prefixed tokens and long hex or base64 runs.

**Wire run** (`toWireRun`): id, request key, group, action, job, state, phase, attempt, exit
code, error code, timestamps, the stored `selection` (only well-formed provider entries plus scan
options) and `source: 'browser'`. The pid and log reference stay server-side. Driver failures map to `DatabaseUnavailableError` or `SchemaNotReadyError`.

**Tests:** `node --test src/server/test-runs.mjs`; the SQL is covered by `test-runs-database.mjs`.

**Publish (Stage 3.5):** `createRunsService({ letterService })` enables `action: 'publish'` with
`{ jobId, requestKey, expectedHash }` (no selection; any other key is 400). Inside the letter
service mutex it: replays a stored key as usual, re-checks `actionsFor` (409 `PREREQUISITE_FAILED`,
`No cover letter to publish.`), refuses while a `publish` or a `letter` run for the job is queued or
running (409 `RUN_ACTIVE`, the message names the blocking action), takes the letter snapshot, and
returns 409 `LETTER_CONFLICT` with `error.current: { text, contentHash }` unless its hash equals
`expectedHash`. The run row has `action 'publish'`, the job set, an empty selection and a
`publish-<job>-<stamp>-<rand>.log` log. The argv is exactly
`node src/cvgen/publish-cover-letter.mjs <absolute cover-letter.md path>`: no `--job`, no provider
flags, no shell, and no provider selection is resolved. The launcher re-checks the file name and
containment itself. `LAUNCHERS` gains `publish`. Without a letter service the action is 503
`TASKS_UNAVAILABLE`.

**Log redaction:** `redactLog` also removes the JSON-escaped form of the repository and home paths
(doubled backslashes) and `C:\\Users\\<name>` after JSON.stringify, which the publish launcher prints
in its result.

**List limit (3.6):** `GET /api/v1/runs?limit=N` bounds the terminal rows (default 12, integer 1
to 50, otherwise 400 `INVALID_REQUEST` with `fields.limit`); queued and running rows are always
listed. It combines with `jobId`.

**3.4 Lows:** `both` resolves every pending child selection before launching either; `actionsFor`, when given, must be a function.

**Legacy rows (4.1 P24):** `list()` appends read-only `source: legacy` rows from `legacy-runs.mjs` after the browser rows (the terminal limit covers both), `get` and `log` resolve a legacy id, `legacy: null` disables it, and browser dispatch writes `run_id` in its TUI record. See `legacy-runs.md`.

## Provider pre-flight (F20)

After the selections are resolved and before any run row is written, dispatch checks that the
command line tool of every provider in the resolved selection exists. `createProviderCheck`
(the default `checkProvider` adapter) reads `claude_command` or `codex_command` from
`config/cv-drafting.json` (default `claude` or `codex`), starts `<command> --version` (through `resolveCommand`, so Windows `.cmd` shims work) with
`shell: false` and a 5 s bound, and calls no model. Only a failure to start the command counts as
missing; a slow probe or a non-zero exit does not block a run. Results are cached per provider for
60 s. A missing tool is 409 `PROVIDER_UNAVAILABLE` with the fixed message "The Claude|Codex command
line tool was not found on this machine." and `error.current = { provider, command }`, where
`command` is only the file name of the configured command so no private path is returned. Nothing is
recorded or spawned. There is no error-code enum in the schemas, so no schema change was needed.
