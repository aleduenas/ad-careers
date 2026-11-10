# Local production web startup

**Authority:** `src/server/start.mjs`.

Exports `parsePort` and `startService` for isolated lifecycle checks. The CLI preflights Node and
installed Vite, runs the fixed `web:build` npm script through Node with an argument array, serves
the canonical `web/dist` output on IPv4 loopback, and opens the hash-route dashboard unless
`--no-open` is supplied. `PORT` accepts only decimal ports 1 through 65535; the listener never
binds a public interface. Startup reports missing dependencies/builds and port collisions without
stopping another process. The returned handle closes the owned Fastify listener and default-owned
DB pool; the CLI handles SIGINT/SIGTERM with graceful closure and terminates only its owned build
process tree if interrupted during npm. Tests inject readiness and browser opening and use an
isolated temporary build; they do not use a personal database or GUI.
