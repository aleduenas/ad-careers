# dashboard/internal/ui/screens/workflow_test.go

**Authority:** [dashboard/internal/ui/screens/workflow_test.go](../../../../../dashboard/internal/ui/screens/workflow_test.go).

Checks evaluation hotkeys, duplicate-job guards, draft-picker deliverables, parallel evaluation and drafting tasks launched through real keyboard events, stable all-task status rendering, out-of-order completion behavior, refresh persistence and tab/search restrictions.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Builds synthetic pipeline models and keyboard events. Exercises screen `workflow.go`; no subprocesses, subscription workers or database required.
