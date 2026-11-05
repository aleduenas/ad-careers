# src/helpers/test-backup-restore.mjs

**Authority:** [src/helpers/test-backup-restore.mjs](../../../src/helpers/test-backup-restore.mjs).

Verified isolated dump and restore.

## Run and callers

Run through `node src/helpers/db-test.mjs`; without `TEST_DATABASE_URL` it explicitly skips.

## Inputs

Requires a URL naming `career_ops_test_*`; uses that URL for direct connections. Compares the server system identifier with the Compose server before fixture writes, refusing a mismatched cluster. Docker client commands use the URL's database/user/password, with the password passed through environment.

## Behavior and outputs

Creates a unique test schema, dumps it with pg_dump custom format, restores into a new test database and checks a Unicode fixture. Cleans its schema, database and temporary files afterward. Uses pg, Docker Compose and Node process/fs utilities. This verifies the backup mechanism; it does not certify arbitrary personal dump files.
