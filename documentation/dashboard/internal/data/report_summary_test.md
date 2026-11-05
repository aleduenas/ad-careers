# dashboard/internal/data/report_summary_test.go

**Authority:** [dashboard/internal/data/report_summary_test.go](../../../../dashboard/internal/data/report_summary_test.go).

Checks extraction of archetype, summary, location and compensation from current and historical evaluation report formats, and that placeholder compensation bands (`UNKNOWN ...`, `Not assessed`) come back empty.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Writes temporary Markdown fixtures, calls `LoadReportSummary` and checks parsed values. Uses Go testing/fs/path helpers; no database required.

