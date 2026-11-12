# src/server/runs-store.mjs

**Authority:** `infra/sql/migrations/010_browser_runs.sql` and
`documentation/dashboard-migration/design/STAGE3_TASKS_CONTRACT.md`.

SQL access for `browser_runs`. `createRunsStore({ query })` takes an injected transport (a
function returning rows or `{ rows }`), keeps no state and touches no business table.

Methods, all returning plain objects (or `null` for a missing row):

- `insert({ id?, requestKey, groupId?, action, jobId?, logRef, selection? })` inserts a `queued`
  row. Constraint failures become `RunsStoreError` with a safe code: `REQUEST_KEY_CONFLICT`,
  `UNKNOWN_JOB`, `INVALID_ARGUMENT`. Raw database text is never exposed.
- `start(id, pid, pidStartedAt)`, `report(id, phase, attempt)`, `finish(id, state, exitCode,
  errorCode)` call the SQL functions; repeated or out-of-order calls return the current row.
- `interruptStale({ deadPids, now })` returns the rows it moved to `interrupted`.
- `list({ jobId, limit })` returns every queued or running row plus the newest `limit` (default
  12, max 200) terminal rows, newest first.
- `get(id)` and `getByRequestKey(key)`.

Row shape: bigint `jobId` as a decimal string, timestamps as ISO strings, `selection` as an
object, ids as uuid strings. `jobId` arguments must be decimal strings.
