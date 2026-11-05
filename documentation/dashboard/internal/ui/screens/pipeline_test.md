# dashboard/internal/ui/screens/pipeline_test.go

**Authority:** [dashboard/internal/ui/screens/pipeline_test.go](../../../../../dashboard/internal/ui/screens/pipeline_test.go).

Checks JD-paste modifier handling and refresh preservation, selected-role artifacts, filters (including Ghosted), text and report-number search, labeled lifecycle-date rendering and ordering, evaluated artifact prioritization and badges, explicit unknown dates, removal of the duplicate totals row, discard-reason rendering and ordering, separate status/discard hotkeys, manual status order without Ghosted, selection/state preservation and Escape behavior.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Uses synthetic application models and Bubble Tea key events. Verifies search typing does not load reports on each keystroke. Exercises `pipeline.go` and `jdpaste.go`; no running UI or database required.
