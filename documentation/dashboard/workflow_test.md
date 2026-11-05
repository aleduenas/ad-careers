# dashboard/workflow_test.go

**Authority:** [dashboard/workflow_test.go](../../dashboard/workflow_test.go).

Checks evaluate/CV/letter command selection (the letter runs `draft-cover-letter.mjs` directly), positive permanent IDs and explicit repository working directories, that `both` is not a command of its own but expands to the CV and letter tasks, and that launching it records two separate tasks with separate logs. It also simulates a periodic pipeline refresh and verifies compensation for a newly appearing, unselected job is prefetched and rendered alongside an already cached salary band.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Builds command objects without running subscription workers. The compensation regression creates temporary report files and renders an in-memory pipeline; it does not access PostgreSQL. Imports Go filesystem/testing helpers and internal model/theme/screen packages; exercises package-main `workflowCommand` and `enrichMissingReportSummaries`.
