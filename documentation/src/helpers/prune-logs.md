# src/helpers/prune-logs.mjs

**Authority:** [src/helpers/prune-logs.mjs](../../../src/helpers/prune-logs.mjs).

Previewable retention policy.

## Run and callers

Run without flags for a JSON dry run, then `--apply` to perform the reviewed actions. `retentionPlan(root, now)` exposes read-only planning for fixture tests.

## Inputs

Reads test/dashboard log ages and dump modification times. Keeps the newest five dumps plus any older dump with a sibling `<dump>.keep` marker. Create such a marker only after deliberately choosing a checkpoint; it is a retention instruction, not proof of an automated restore.

## Behavior and outputs

Deletes test logs older than seven days and dashboard logs older than thirty; archives named legacy log folders. Never prunes evaluation/drafting/publishing evidence, token logs, locks or archive contents. Uses Node fs/path/URL and root. Protected checkpoints, normal expiry and default dry-run behavior are covered by the retention test.

A `.keep` marker does not consume one of the five newest slots; protected older dumps remain in addition to those five.
