# src/helpers/db-cutover.mjs

**Authority:** [src/helpers/db-cutover.mjs](../../../src/helpers/db-cutover.mjs).

Legacy recovery orchestration.

## Run and callers

Run `node src/helpers/db-cutover.mjs` only for deliberate recovery, not ordinary onboarding.

## Inputs

Reads whether legacy tracker files remain. Executes database up/migrations and `db-test.mjs`, which includes backup/restore. Audits legacy import before applying it and skips import steps if no legacy input exists.

## Behavior and outputs

Synchronizes JDs, verifies references, creates a backup and archives verified legacy inputs. Stops at the first failed child. Source data stays recoverable; the separate backup-test invocation that used to skip has been removed. Imports Node process/fs/path and the shared root.
