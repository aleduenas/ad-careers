# src/lib/test-task-status.mjs

**Authority:** [src/lib/test-task-status.mjs](../../../src/lib/test-task-status.mjs).

Unit tests for worker task reporting.

## Run

`node src/lib/test-task-status.mjs`, and as part of `node src/test-all.mjs`.

## Inputs, dependencies and side effects

Writes a task record and stand-in worker scripts in a temporary directory, then runs them with `CAREER_TASK_FILE` set. Covers the no-op path without a task file, phase and retry updates that preserve the dashboard-written fields, and terminal state for both a clean exit and a crash. No database, network or subscription CLI.
