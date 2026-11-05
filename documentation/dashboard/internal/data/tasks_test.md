# dashboard/internal/data/tasks_test.go

**Authority:** [tasks_test.go](../../../../dashboard/internal/data/tasks_test.go).

Checks the task registry's reconciliation, history and write contract.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Writes records and task logs in a temporary directory. Covers a live owner staying `running`, a dead process ID and a day-old record becoming `interrupted`, a finished record never being reconciled, unrecorded task logs appearing without duplicating recorded ones, newest-first ordering, and atomic writes that leave no temporary file and never serialize a record's own path. No database, network or subscription CLI.
