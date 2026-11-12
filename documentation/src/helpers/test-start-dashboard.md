# src/helpers/test-start-dashboard.mjs

**Authority:** `src/helpers/test-start-dashboard.mjs`. Unit test for the pure parts of
[dashboard-supervisor.mjs](dashboard-supervisor.md); discovered by `src/test-all.mjs`.

Covers the server arguments (first start builds, crash restarts use `--no-build`), port argument parsing (default, `PORT`, `--port`, invalid values), the restart policy
(growing delay, delay cap, give up after five failures in ten minutes, spread failures never give
up) and log rotation under a temporary path with spaces (missing file, under the limit, chain of
three files, oldest dropped). The process behavior (start, stop, restart, crash recovery, database
wait) is exercised on the machine and recorded in the 4.4a build handoff.
