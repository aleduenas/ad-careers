# src/cvgen/_cv-drafting.mjs

**Authority:** [src/cvgen/_cv-drafting.mjs](../../../src/cvgen/_cv-drafting.mjs).

Job identity, candidate identity and output locks.

## Run and callers

Imported by drafting/publishing code; no standalone command. Reads candidate.full_name from private profile.yml, job/JD rows from PostgreSQL and the referenced evaluation report.

## Inputs

`jobOutputPath(root, job)` requires a positive permanent ID and returns `output/<company>/<role>--<id>/`. New drafts cannot overwrite another posting merely because titles match. Existing legacy folders are preserved for dashboard fallback.

## Behavior and outputs

Derives candidate filenames/signatures and resolves model input paths. `withOutputLock(archive, out, artifact, runId, action)` creates an exclusive archive lock per output folder and artifact (`cv` or `letter`) under `logs/drafting/locks/` (`<out-slug>.<artifact>.lock`) recording the run ID, process ID and start time, and removes only its own lock on completion. The CV and the letter write different files, so they lock separately and the dashboard's CV + cover letter action runs both at once. A lock whose owner is still alive and less than six hours old rejects the new run, naming the holder. Any other lock — dead owner, older than six hours, or a pre-owner-tracking file — is stale and is reclaimed with a logged note, so a draft killed mid-run (closing the dashboard, a restart) cannot block that role's output folder forever. Uses js-yaml, Node fs/path, database/JD helpers and `_cv-content.mjs`. Unit tests cover identity, ID separation and concurrency.

Customization extraction preserves every paragraph until the next lettered section (or EOF), supports current E) and historical E. headings, and returns an explicit fallback when absent. Regression fixtures cover LF and CRLF reports.
