# src/server/test-intake.mjs

**Kind:** synthetic Node test suite for `src/server/intake.mjs`. Run with `node --test
src/server/test-intake.mjs`. A fake query and a fake executor stand in for PostgreSQL and the
launcher. Cases: check (normalized URL, tracked job, seen sighting with the newest row, neither,
unparseable input never reaching the database, bad bodies); companies (normalized prefix match,
distinct spellings, sorted, capped at 10, bad `q`); preview argv, cwd, stdin payload with the text
byte for byte (CRLF, tabs, trailing spaces) and `force` defaulting to false; body validation before
anything runs; unparseable or out-of-repo launcher output; every launcher failure message mapped
to its public error with the current state, generic failures that leak nothing, timeout and
database errors; add parsing including a company that contains a dash separator; the discovery
lock and active-scan refusal (nothing runs, lock released after refusals and failures, previews
never take it); and the real executor on tiny scripts (stdin, environment, argv, output cap,
timeout kill, missing binary). No database, network or real launcher is used.

Also covers a job stored under an older key (tracking parameter, `/en-US/` Workday segment) being found by the clean URL, and the `scan_history` lookup receiving both the new and old-rule keys.
