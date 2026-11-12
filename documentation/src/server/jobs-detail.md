# src/server/jobs-detail.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE2_WORKSPACE_CONTRACT.md`.

Read-only service behind `GET /api/v1/jobs/:id` and `GET /api/v1/jobs/:id/materials/:key`.
`createJobsDetail({ query, readCompensation, resolveMaterials, findPrep, rootDir })` returns a
frozen `{ detail(id), material(id, key) }`. Defaults use the lazy shared PostgreSQL pool, the
2.1 compensation reader, `resolveJobMaterialDetail` and `findInterviewPrep`; every adapter can be
injected, so tests use an in-memory `query` and a temporary repository root.

**detail(id):** validates `id` (`^[1-9][0-9]{0,18}$`, else 400 with `fields.id`; above the bigint
maximum or unknown is 404), then runs four parameterized SELECTs (job with the list's lateral
joins, `job_descriptions`, `evaluations` newest first, `job_status_events` oldest first). The job
is projected with the list's `projectJob`, plus `notes` and a boolean `evaluationError` (the raw
error text never leaves SQL). The report is read from `report_path` through `inspectSafeFile`
under `data/evaluations` and `output` (1 MB, strict UTF-8) and reported as `ok`, `missing`,
`invalid` or `unsafe`. Materials list the preferred file per key (`cv`, `letter`, `brief`) with
size and modified time; each file is re-checked for containment, and an ambiguous duplicate-ID
folder lists nothing. `interviewPrep` is `{name,size}` only for Interview jobs. History
timestamps are never substituted: a null `occurredAt` stays null. File paths, the JD path and
report paths are never returned.

**actions:** the detail also carries `actions: {evaluate, cv, letter, both: {enabled, reason}}`
(STAGE3_DISPATCH_CONTRACT.md), from the reads it already does plus one query for active runs.
`buildActions` (exported) uses only the status, whether a JD row exists, whether the job's report
file is readable and the queued or running `browser_runs` rows; a score is never consulted.
Evaluate needs a Pending or Evaluated job and a JD ("Only Pending or Evaluated jobs can be evaluated." / "No job description
stored."); cv and letter need a JD and a report ("No job description stored." / "Evaluate the job
first."); both needs cv and letter. An active run of the same action disables it with "A <action>
run is already active." (both names cv or letter), and a failed prerequisite wins over that reason.
If the active-run query fails (no `browser_runs` table, a fixture transport) there are simply no
active runs. `actionsFor(id)` returns `{actions, base}` for the run service's dispatch re-check;
`base` ignores active runs, which the run service reports as RUN_ACTIVE.

**material(id, key):** `key` is `cv`, `letter`, `brief` or `prep` (else 400 with `fields.key`).
The job and file are re-resolved on every request; the client supplies no path. A key the detail
did not list, or `prep` for a non-Interview job, is 404. Text kinds are read whole (1 MB cap,
strict UTF-8; larger or undecodable is 404) and returned as `{kind:'text', text}`; PDF returns
`{kind:'pdf', size, stream()}`, opened only when called. The route serves text as `text/plain`
and PDF inline.

**Errors:** database and schema failures reuse `DatabaseUnavailableError` and
`SchemaNotReadyError`; nothing from a driver reaches the wire.

**Also exports:** `jobDetailSql` (the reviewed statements, SELECT only) and `findInterviewPrep`,
which mirrors Go `findInterviewPrepPath` (exact `<company>-<role>.md`, then the best company plus
role-word match in file-name order, skipping `story-bank.md` and `README.md`).

**Tests:** `node --test src/server/test-jobs-detail.mjs`; the isolated database case is in
`test-jobs-database.mjs`.

**Publish action (Stage 3.5):** `actions.publish` is enabled when the resolved letter material is
the exact `cover-letter.md` within `LETTER_MAX_BYTES` (256 KB, exported). Reasons are `No cover
letter to publish.` (first), `A publish run is already active.` and `A letter run is already
active.` (a running draft rewrites the letter). Status, JD, report and score are not consulted;
other active runs do not matter. `actionsFor` now also lists the materials so the dispatch
re-check and the detail agree. `buildActions` takes `letterReady` (default false).
