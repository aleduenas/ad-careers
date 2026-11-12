# src/server/ghosting.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_EDIT_CONTRACT.md` (Automatic Ghosted
rule).

The server owns the automatic Ghosted rule. `createGhosting({ query, readiness, intervalMs, log,
onError })` returns `{ runOnce, start, stop }`. A pass checks readiness, then runs
`SELECT ghost_stale_applications()` (Applied rows whose `applied_at` is over 40 days old move to
Ghosted with a `dashboard-auto` event) and logs the moved count. `start()` runs a pass immediately
(after readiness succeeds) and then every hour; passes never overlap; a failed readiness or query
logs a generic "skipped" line, never driver text, and the next hour tries again. `stop()` clears
the timer.

`createApp` creates it only with the default readiness check and no injected readers, starts it on
`listen`, and stops it on close, so tests and fixture servers never ghost anything. The TUI call on
every load is not reproduced.

**Tests:** `node --test src/server/test-ghosting.mjs`; the 40-day boundary is covered in
`test-jobs-write-database.mjs`.
