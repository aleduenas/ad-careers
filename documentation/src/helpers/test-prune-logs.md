# src/helpers/test-prune-logs.mjs

**Authority:** [src/helpers/test-prune-logs.mjs](../../../src/helpers/test-prune-logs.mjs).

Creates eight synthetic dump files and a retention marker. Verifies that the newest five and the explicitly protected checkpoint survive the proposed plan. Uses temporary files and read-only retentionPlan; never prunes personal backups.

Run: `node src/helpers/test-prune-logs.mjs`. Assertions fail with a nonzero exit code. Discovered by `src/test-all.mjs`; database/Chromium prerequisites are described above.

