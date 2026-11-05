# dashboard/internal/ui/screens/viewer_test.go

**Authority:** [dashboard/internal/ui/screens/viewer_test.go](../../../../../dashboard/internal/ui/screens/viewer_test.go).

Checks role artifact actions, letter edit/publish messages, busy-state guards, scroll bounds, empty content, mixed inline tokens, fenced-code wrapping and blockquotes.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Uses synthetic viewer content and Bubble Tea events; tests emitted messages rather than opening external applications. Exercises `viewer.go`; no database required.

