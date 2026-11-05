# src/lib/_job-workflows.mjs

**Kind:** shared module
**Purpose:** Provides the two database-backed safety primitives the evaluation launcher relies on: a renewable per-resource lease (`lease`) built on the `claim_work` SQL function, and immutable evaluation publication (`publishEvaluation`) that writes the report file atomically and records completion through `complete_evaluation` with an idempotency key.

## Run
Not runnable; imported by other modules.

## Reads
- PostgreSQL: `workflow_claims` (lease assertion), via `query`
- `data/evaluations/<report>-<operation>.md` if it already exists (compared byte-for-byte against the new report)

## Writes
- PostgreSQL: `claim_work(resource, owner, 300)` on acquire and every 60 s; `DELETE FROM workflow_claims` on release; `complete_evaluation(job_id, owner, key, score, report_path, status, note)`
- `data/evaluations/<report_path minus .md>-<operation>.md`, written to a `.<uuid>.tmp` sibling then renamed

## Imports
- `src/lib/_database.mjs` (`query`, `root`)

## Used by
- `src/eval/evaluate-jobs.mjs` (`lease`, `publishEvaluation`)

## Notes
- `lease(resource, owner)` throws "Work already claimed" if another live owner holds the resource. It returns a `release()` function carrying `release.assert()`, which rethrows any renewal failure and verifies the row is still owned and unexpired. The renewal timer is `unref`ed so it never keeps the process alive.
- `publishEvaluation(job, result, report, owner, operation=owner)` refuses any `job.report_path` outside `data/evaluations/`. The published filename gets `-<operation>` appended, so a retry with the same operation key either finds identical content (no-op) or throws "Published report differs from retry"; it never overwrites.
- The idempotency key passed to `complete_evaluation` is `operation + ':' + job.num`; the SQL function rejects a reused key with different score/path/status and rejects completion when the lease is lost.
- `complete_evaluation` only changes `jobs.status` when it is still `Pending`, so a manual status set during a long evaluation is preserved (see `src/helpers/test-database.mjs`).
