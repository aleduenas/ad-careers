# src/server/jobs-write.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_EDIT_CONTRACT.md`.

The three immediate writes of Stage 3.2. `createJobsWrite({ query, transaction, detailReader,
rootDir, fs })` returns a frozen `{ changeStatus, updateMetadata, saveJd }`. `detailReader` is the
2.2 detail reader; every success returns its updated `job` (and `jd`) so the client refreshes
without a second read. Defaults use the shared pool; all adapters can be injected. Nothing here
starts a worker, and a score is never consulted.

**changeStatus(id, { expectedRevision, status, reason })** validates the id (400 `fields.id`,
unknown or above bigint is 404), a decimal revision, a status from Applied, Rejected, Interview,
Offer, Pending, Evaluated or Discarded (Ghosted is never manual), and a reason of at most 200
characters with control characters stripped. Discarded needs a non-blank reason (the SQL function
enforces it too). It calls `change_job_status(id, revision, status, reason, 'browser')`. SQLSTATE
40001 is 409 `REVISION_CONFLICT`. Requeue to Pending starts nothing.

**updateMetadata(id, { field, expectedValue, value })** edits `company`, `role`, `url` or
`salaryBand` with a field-value guard (`UPDATE ... WHERE id AND <col> IS NOT DISTINCT FROM
expected`, revision bumped); zero rows is 404 for an unknown job and 409 `FIELD_CONFLICT`
otherwise. Strings are control-stripped, trimmed, non-empty, at most 300 characters. A URL must be
http(s) without credentials and sets `url_key` (`urlKey`) in the same statement; a unique violation
is 409 `URL_IN_USE`. Because the job DTO shows the URL normalized, the URL guard also accepts the
stored `url_key` of the expected value. A salary band is `{min, max}` decimal strings with
`0 <= min <= max` (compared exactly), guarded on both columns, or `null` to clear both. Notes are
not editable.

**saveJd(id, { expectedRevision, expectedHash, text })** runs in one transaction: it locks the
job and its `job_descriptions` row and compares revision and hash with the expected values (a job
with no JD expects revision `0` and an empty hash). A mismatch is 409 `JD_CONFLICT` with the
current `{text, contentHash, revision}` (text and hash null when none). Text is non-blank, at most
2 MB, line endings normalized, no NUL; the `<!-- career-ops-job-id: N -->` tag is added with
`withJobID` (a tag for another job is 400) and the SHA-256 of the tagged text is stored. The
database is written first with `sync_job_description` using the stored path (or
`data/jds/<id>.md` when none or unsafe); identical text returns the current row with no new
revision. After the commit, `writeJdCache` writes the file atomically (temp plus rename, contained
under `data/jds`, never through a symlink or onto a directory). A failed cache write is still
committed and returned with `cacheSync: 'error'`.

**Errors:** conflicts carry the current state in `error.current`. Driver failures map to
`DatabaseUnavailableError` or `SchemaNotReadyError`; raw text never reaches the wire.

**Tests:** `node --test src/server/test-jobs-write.mjs`; the real SQL is covered by
`test-jobs-write-database.mjs`.
