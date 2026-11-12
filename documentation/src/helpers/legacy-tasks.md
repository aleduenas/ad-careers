# src/helpers/legacy-tasks.mjs

**Authority:** `src/helpers/legacy-tasks.mjs`. Read-only audit of the task records the retired Go
TUI left under `logs/dashboard/tasks/`, to confirm that no work launched by the TUI is still
running. The record format is described in `documentation/src/server/legacy-runs.md`.

## Run

`node src/helpers/legacy-tasks.mjs [--json] [--all] [--dir=PATH]`

- Default output: counts per state, every record that blocks, is interrupted or unreadable, and a
  final verdict. `--all` also lists finished records. `--json` prints the full report for tooling.
- `--dir=PATH` audits another directory (tests use it; default is `logs/dashboard/tasks`).
- Exit 0: nothing blocks. Exit 2: at least one task is running with a live owner. Exit 1: usage
  error, or an explicit `--dir=` that does not exist (the default directory may legitimately be
  missing and then reports 0 records).

## What it decides

Records are read with `parseLegacyRecord` and the one-day and start-time-window constants from `src/server/legacy-runs.mjs`, shared with the browser runs list; a record that parser refuses (unknown action or state, bad numbers or timestamps, invalid JSON) is listed as `unreadable`. The format is described in
`documentation/src/server/legacy-runs.md` and written by `src/lib/_task-status.mjs`. A record whose state is not `running` is reported as written
(`completed`, `failed`) and never blocks. A `running` record is classified by its owner:

| Owner | Meaning | Effective state | Blocks cutover |
|---|---|---|---|
| live | pid alive and its start time agrees with `started_at` (from 5 s before to 30 s after) | running | yes |
| unknown | pid alive but the start time could not be read | running | yes (assumed owner) |
| recycled | pid alive but started at a different time, so another process | interrupted | no |
| gone | pid not running, no pid recorded, or running for over 24 hours | interrupted | no |

Records written for browser runs are flagged `browserRun` in the JSON and still count toward blocking, because a live worker blocks a cutover whoever launched it. Start times come from `readProcessStartTime` in `src/server/runs.mjs` (Windows only; elsewhere
the answer is the plain "pid alive" check). The effective state of a running record comes from `classifyLegacyRecord` in `legacy-runs.mjs`; this helper adds only the owner and reason text. Unreadable or refused records are reported but not judged and never block; they produce a warning. Age counts from the finish time, else the last update, else the
start. Log paths inside records are not echoed.

## Reads and writes

Reads every `*.json` under the directory. Writes, deletes and signals nothing; blocked tasks are
reported and left to finish.
