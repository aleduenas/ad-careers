# src/server/test-jobs-write.mjs

**Kind:** synthetic Node test suite for `src/server/jobs-write.mjs`.

Run with `node --test src/server/test-jobs-write.mjs`. An in-memory query and transaction stand in
for PostgreSQL and a temporary root holds the JD cache. Cases: status validation (ids, revisions,
every status including Ghosted refused, blank and oversized reasons, extra keys), each allowed
status through `change_job_status` with the dashboard actor, revision conflict with the current
job, unknown job and the SQL discard rule; metadata validation per field, the field-value guard
SQL, URL scheme and credential rules, `url_key` in the same statement, `URL_IN_USE` (also when the URL is held under an older stored key) (including a URL held under an older stored key), salary band
set, partial expected pair, exact decimals and clear, `FIELD_CONFLICT` versus 404, constraint
failure; JD validation, tagging and CRLF normalization, database-then-cache order, unchanged text,
`JD_CONFLICT` with the current text, a missing JD, unsafe stored paths, a failed cache write
reported as `cacheSync: 'error'`, and `writeJdCache` containment (escapes, symlink target,
directory target). Driver text never leaks. No database or personal data is used.
