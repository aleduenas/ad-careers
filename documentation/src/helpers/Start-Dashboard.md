# src/helpers/Start-Dashboard.ps1

**Authority:** `src/helpers/Start-Dashboard.ps1`. Windows wrapper that starts the browser dashboard
(`node src/server/start.mjs`) from the repository root, with checked prerequisites and a clean
stop. It is an optional convenience; `npm run web:start` stays the documented start command.

## Run

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\src\helpers\Start-Dashboard.ps1 [-Port N] [-NoOpen] [-Check] [-Stop] [-Up] [-Restart] [-Status] [-Install] [-Uninstall]
```

`npm run web:start:win` runs the same command. If Windows PowerShell answers `npm.ps1 cannot be
loaded because running scripts is disabled`, that is the shell's execution policy blocking npm's
own PowerShell shim, not this script (which always runs with `-ExecutionPolicy Bypass`). Either run
`npm.cmd run web:start:win`, or allow signed scripts once with
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

The repository root comes from the script's own location (two levels up), never from the current
directory, so the script works from any directory and from a checkout whose path contains spaces.
The server listens on `127.0.0.1` only.

| Switch | Effect |
|---|---|
| (none) | Check prerequisites, start the server in this console, wait until the port accepts connections, print the address, stay in the foreground |
| `-Port N` | Loopback port; default the `PORT` environment variable, then 4310 |
| `-NoOpen` | Do not open the browser |
| `-Check` | Run the prerequisite checks and exit without starting anything |
| `-Stop` | End the recorded server, foreground or service (private pid record `logs/dashboard/web-server.json`); exits 0 even when nothing runs |
| `-Up` | Start the always-on background service (see below); no-op if already running |
| `-Restart` | `-Stop`, then `-Up`; waits until the port answers |
| `-Status` | Running or not, mode, pid, port, uptime, URL, logon entry installed or not |
| `-Install` | Register the logon entry (Task Scheduler, current user, no administrator rights), then `-Up` |
| `-Uninstall` | Remove the logon entry; a running server is left alone |

## Prerequisites and failure text

Each check stops with one message beginning `Dashboard not started:` and its own exit code.

| Exit | Problem | What the message tells you |
|---|---|---|
| 10 | Node.js missing or older than 24 | Install Node.js 24 or newer |
| 11 | Script not inside a career-ops checkout | Looked for `src\server\start.mjs` |
| 12 | `vite`, `fastify` or `pg` missing, or npm missing next to Node | Run `npm install` / reinstall Node |
| 13 | Database not configured, unreachable or credentials rejected | `db-infra.mjs init`, `npm run db:up`, or fix `.env`; no connection detail or password is printed |
| 14 | Port in use | Names the holding process and pid; nothing is stopped |
| 15 | A server started by this script already runs | Use `-Stop` first |
| 16 | The server exited before it was ready, or opened no port in 3 minutes | The server's own message is printed above it |
| 17 | Invalid `-Port` | Port must be 1 to 65535 |
| 18 | retired | `-Stop` is idempotent and exits 0 when nothing runs |
| 19 | Logon entry could not be registered | The Task Scheduler message is printed |

The database check runs `SELECT 1` through the repository's own connection module and reports
only `OK` or a fixed code. It reads `.env` through that module; the script never prints it.
`npm_execpath` is set for the server because `start.mjs` locates npm through it, and plain
`node src/server/start.mjs` outside npm otherwise cannot run the frontend build.

## Stopping and background work

- **Ctrl+C** in the console reaches both the wrapper and the server; the server closes its
  listener and pool and exits 0. If it has not exited after 10 seconds the wrapper ends the server
  process only.
- **`-Stop`** from another console verifies the recorded pid is still the same process (start
  time within 5 seconds), removes the record and ends that one process. Windows offers no
  graceful signal from outside, so this is a forced end of the server alone; the foreground
  wrapper then exits 0.
- Neither path ends detached workers: only the server's own process is stopped, never its process
  tree, so running evaluations, drafts and scans continue and finish on their own. Runs whose
  worker had died are marked interrupted by the next server start; a run is never reported
  successful because the server stopped.

## Always-on service

`-Up`, `-Restart` and `-Install` run [dashboard-supervisor.mjs](dashboard-supervisor.md) in a hidden
process. It does not need the database to be up: it probes every 5 seconds for up to 5 minutes,
then starts the server anyway (the readiness card reports an unavailable database, and the server
reconnects by itself once PostgreSQL is back). It restarts a dead server after a growing delay and
stops retrying after five failures in ten minutes, leaving a line in the log. `-Up` and
`-Restart` print the URL once the port answers, or say that the service is waiting for the
database; they fail with exit 16 and the last log lines if it does not come up in 3 minutes, and
with exit 14 if another program holds the port. The URL printed is `http://localhost:PORT/`; the
server still listens on `127.0.0.1` only.

- **Logon entry.** `-Install` registers the scheduled task `career-ops dashboard` for the current
  user: at-logon trigger, interactive logon, limited rights, no time limit, a single instance. It
  runs `conhost.exe --headless node dashboard-supervisor.mjs --port N` so no window appears. The
  task holds only paths and the port, no secret; the server reads `.env` itself. Repeating
  `-Install` replaces the entry. Task-level restart is not used; the supervisor does the restarts.
- **One record, two modes.** The foreground and service modes share `logs/dashboard/web-server.json`.
  `-Stop`, `-Restart` and `-Status` act on whichever is recorded, so `-Restart` takes over a
  foreground server. For a service the record also holds the supervisor's pid and start time; a
  stop ends the supervisor first (so it cannot restart the server), then the server, and never a
  process tree, so detached workers keep running.
- **Log.** `logs/dashboard/server.log` receives the server's output and the supervisor's lines.
  It rotates at 5 MB, keeping `server.log`, `.1` and `.2`; rotation happens when the server
  starts, so a server that runs for weeks can grow past 5 MB until its next start.

## Reads and writes

Reads the repository layout, `node_modules`, the database (`SELECT 1`) and the pid record. Writes
only `logs/dashboard/web-server.json` (pids, start times, port, state; no secret), removed on a stop, and for the service `logs/dashboard/server.log`, plus the Task Scheduler entry with `-Install`.
`npm run web:start` and the web build are unchanged.
