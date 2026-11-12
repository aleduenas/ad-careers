# src/helpers/dashboard-supervisor.mjs

**Authority:** `src/helpers/dashboard-supervisor.mjs`. Keeps the browser dashboard server running in
the background. Started hidden by [Start-Dashboard.ps1](Start-Dashboard.md) (`-Up`, `-Restart`,
`-Install`) and at logon by the scheduled task. Not meant to be run by hand.

`node src/helpers/dashboard-supervisor.mjs [--port N]` (default `PORT`, then 4310).

## Behavior

1. A second supervisor exits at once when the recorded one is alive (pid plus start time).
2. Writes `logs/dashboard/web-server.json` atomically with state `waiting-database`, `running`,
   `backoff` or `gave-up`, plus the server pid when there is one.
3. Probes PostgreSQL every 5 seconds for up to 5 minutes through the repository's connection
   settings (an unconfigured database does not wait), then starts the server regardless.
4. Rotates `logs/dashboard/server.log` (over 5 MB, three files kept), then runs
   `node src/server/start.mjs --no-open` (the first start builds the frontend; restarts after a crash add `--no-build` when `web/dist` exists, so the build stamp and open tabs stay as they are) from the repository root with stdout and stderr appended to
   the log. The npm launcher next to Node is passed as `npm_execpath` so the frontend build runs.
5. When the server exits it is restarted after 3 s times the failure count (at most 30 s). Five
   failures within ten minutes, or a port held by another program, are counted; after the fifth
   it logs that it gave up, records `gave-up` and exits 0 (so no outer restart loop starts).
6. SIGINT or SIGTERM stops the server and removes the record. `Start-Dashboard.ps1 -Stop` ends the
   supervisor first and then the server.

It never signals detached workers, holds no secret and never opens a browser. Exports
`rotateLog`, `createRestartPolicy`, `serverArgs` and `parseArgs` for [the test](test-start-dashboard.md).
