# Startup lifecycle tests

**Authority:** `src/server/test-start.mjs`.

Exercises port validation, startup and shutdown using a temporary repository path containing
spaces, injected readiness, and an injected URL opener. A synthetic readiness outage must remain a
safe API 503 while health stays live. It checks the `--no-open` path, listener cleanup after
opener failure, missing-dependency/build and occupied-port errors, and owned child-tree termination
on an injected interruption. The test removes only temporary directories returned by its own
`mkdtemp` calls; it does not invoke a GUI, contact a database, or control unrelated processes.

Also covered: an injected `letterService` reaches the app (`test-start.mjs`).

Also covered: `locateNpmCli` order and the not-found error.
