# src/server/intake.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_INTAKE_SCAN_CONTRACT.md`; the rules
live in `src/scan/add-pasted-jd.mjs`, which this module only runs and parses.

Pasted-JD intake for the browser. `createIntakeService({ query, execute, rootDir, env,
discoveryLock, activeScanRunId, timeoutMs })` returns a frozen `{ check, companies, preview, add }`.
Defaults use the shared pool and the bounded `runLauncher` executor; every adapter can be injected.

**check({ url })** normalizes the URL with the launcher's own `normalizeUrl` and looks it up with
the TUI's rules: a `findJobByUrl` match (`urlKey(jobs.url)` compared in JS, so rows stored under an older key are found) returns `tracked` `{id, company, role, status}`; otherwise
a `scan_history` match (SQL reduction with the old rules, matched against both the new `urlKey` and the old-rule key of the incoming URL; a scan_history row stored with a tracking parameter is not matched by the clean URL, since loading about 125,000 rows per request was ruled out; newest sighting) returns `seen` `{company,
title, status, firstSeen}`; an unparseable URL returns `{url: null, tracked: null, seen: null}`.
Read-only.

**companies({ q })** returns up to 10 distinct company spellings from `jobs` and `scan_history`
whose normalized key (letters and digits, lowercase) starts with the normalized `q` (1 to 100
characters), sorted case-insensitively; the TUI's suggestions.

**preview(body) and add(body)** take `{url, company, role, text, force?}` (strict keys; the text
is capped at 2 MB). They run `node src/scan/add-pasted-jd.mjs [--dry-run]` by argv, no shell, with
the JSON payload on stdin (the text passes through byte for byte), a 30 s timeout and 64 KB output
caps. A dry run prints a JSON line that becomes `{company, role, url, jdPath}` (the company is the
launcher's canonical spelling); a real run prints `Added #N — company — role (path; JD saved
verbatim)` that becomes `{id, company, role, jdPath}`. `jdPath` is made repo-relative and anything
outside the repository is refused. The launcher's fixed messages map to: 400 `INVALID_REQUEST`
with `fields` `url`, `company`, `role` or `text`; 409 `DUPLICATE_JOB` with `current: {tracked}`
(never bypassable, even with `force`); 409 `SEEN_URL` with `current: {seen}` (retry with
`force: true`); a timeout is 503 `INTAKE_TIMEOUT`; anything else is a generic 500
`INTAKE_FAILED`, never launcher or driver text.

**Discovery lock:** `add` holds the shared lock for the whole run and also refuses while a scan row
is queued or running (`activeScanRunId`), so intake and scans never overlap (409 `DISCOVERY_BUSY`
with `current: {activeRunId}`, null when another intake holds the lock). Previews take no lock.

**Tests:** `node --test src/server/test-intake.mjs` (fake executor); the real launcher against an
isolated database is in `test-intake-database.mjs`.

Note: browser textareas normalize pasted CRLF line endings to LF before the request is built; the
request path itself (JSON body, stdin, launcher, database, cache file) is byte-exact. `add` also
recovers when the launcher exits 0 but prints an unexpected line: the pattern is tried first, then
the job is looked up by its normalized URL (the lookup `check` uses) and returned with its stored
JD path, or a 500 only when no such job exists.
