# dashboard/internal/ui/screens/tasks_test.go

**Authority:** [tasks_test.go](../../../../../dashboard/internal/ui/screens/tasks_test.go).

Checks the task monitor's layout, navigation and live refresh.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Renders an in-memory monitor from task records. Covers completed work appearing above active work, outcomes and phase/retry wording, opening the selected log from either section including a running task's live log, and a cursor that stays in range when the list changes under it. No filesystem, database or subscription CLI.
