# Local production web startup

**Authority:** `src/server/start.mjs`.

Exports `parsePort` and `startService` for isolated lifecycle checks. The CLI preflights Node and
installed Vite, runs the fixed `web:build` npm script through Node with an argument array, serves
the canonical `web/dist` output on IPv4 loopback, and opens the hash-route dashboard unless
`--no-open` is supplied. `--no-build` skips the frontend build and serves the existing `web/dist` (the page build stamp stays that directory's modification time); it fails with the usual missing-build message if `web/dist` does not exist. The always-on supervisor uses it for crash restarts. `PORT` accepts only decimal ports 1 through 65535; the listener never
binds a public interface. Startup reports missing dependencies/builds and port collisions without
stopping another process. The returned handle closes the owned Fastify listener and default-owned
DB pool; the CLI handles SIGINT/SIGTERM with graceful closure and terminates only its owned build
process tree if interrupted during npm. Tests inject readiness, `jobsReader`, `jobDetailReader`, `jobsWriter`, `runsService`, `intakeService`, `providersService` and `letterService` (all forwarded to `createApp`; `null`
for `runsService` disables runs) and browser opening and use an
isolated temporary build; they do not use a personal database or GUI.

**npm lookup:** `locateNpmCli` tries `npm_execpath`, a copy under the repository, the npm beside the node binary, then `npm` or `npm.cmd` on PATH (the cli next to the launcher on Windows, under `../lib/node_modules` next to the real launcher on Unix); it is always started as `node <cli> run web:build`. The error `npm launcher is unavailable` remains when none exists.

After the build check it computes the build stamp once (ISO mtime of `web/dist/index.html`, `'dev'` if unreadable) and passes it to `createApp` as `buildStamp`; `/session` returns it as `build`.
