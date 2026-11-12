# src/helpers/test-legacy-tasks.mjs

**Authority:** `src/helpers/test-legacy-tasks.mjs`. Unit and process test for
[legacy-tasks.mjs](legacy-tasks.md); discovered by `src/test-all.mjs`.

Covers every owner classification with injected liveness and start-time functions (live, gone,
recycled earlier and later, start time unreadable, over 24 hours, no pid, terminal records), an audit
of a synthetic task directory under a temporary path containing spaces (counts, newest-first
order, unreadable and refused records, missing directory, log paths not echoed, directory byte-for-byte
unchanged afterwards), a real child process that blocks while alive and stops blocking once it
exits, and the CLI exit code and `--json` output. Uses only synthetic records; never reads
`logs/`.
