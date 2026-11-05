# Dashboard reference

**Authority:** [dashboard/README.md](../../dashboard/README.md).

The source README documents building, launching, navigation and daily actions. Implementation authority is `dashboard/main.go`, `workflow.go` and `internal/`; PostgreSQL owns application state. Start with [main](main.md), [workflow execution](workflow.md), [data loading](internal/data/database.md) and [pipeline screen](internal/ui/screens/pipeline.md). Run `go test ./...` and `go build -o dashboard.exe .` from `dashboard/` after dashboard changes.

