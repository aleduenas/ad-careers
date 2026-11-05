# dashboard/internal/data/tasks.go

**Authority:** [tasks.go](../../../../dashboard/internal/data/tasks.go).

The durable registry of dashboard-launched background tasks.

## Inputs

Reads task records from `logs/dashboard/tasks/*.json` and task logs from `logs/dashboard/*.log` under the configured repository path. `WriteTask` stores one record; `LoadTasks` returns them all.

## Outputs and behavior

Workers run detached, so a record plus the liveness of its owning process is the only authority on what is running: `LoadTasks` reconciles any record still claiming `running` against its process ID and reports `interrupted` when the owner is gone, or when the record is more than a day old (guarding against a recycled process ID). States are `running`, `completed` and `failed`, written by the worker through `src/lib/_task-status.mjs`, plus reader-decided `interrupted` and `unrecorded`. Task logs with no record — history from before the registry — are returned as `unrecorded` so they stay visible, and a log that belongs to a record is never listed twice. Results are ordered newest activity first. Writes are atomic (temporary file plus rename). Records are pruned with the rest of `logs/dashboard` by `src/helpers/prune-logs.mjs`.

## Dependencies and callers

Imports Go JSON/filesystem/path/sort/time utilities; process liveness comes from `tasks_windows.go` or `tasks_other.go`. Written by `dashboard/workflow.go` at launch, read by `main.go` on every refresh and rendered by the pipeline status bar and `internal/ui/screens/tasks.go`.
