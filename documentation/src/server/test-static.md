# Static serving tests

**Authority:** `src/server/test-static.mjs`.

Creates a synthetic build in a uniquely created temporary directory and exercises the handler over
loopback HTTP. Checks the built index, asset delivery, deep-link fallback, production HTML CSP,
API namespace reservation, traversal rejection, and symlink escape where the host permits symlink
creation. The test removes only its exact `mkdtemp` directory after recording that path at
creation; it has no database or browser dependency.
