# dashboard/internal/data/tasks_other.go

**Authority:** [tasks_other.go](../../../../dashboard/internal/data/tasks_other.go).

Non-Windows process-liveness check for the task registry.

## Inputs

Every non-Windows build selects this file; `processAlive` receives a process ID.

## Outputs and behavior

Reports whether a task's owner still exists. `os.FindProcess` always succeeds on Unix, so liveness is decided by signal 0. No file or command I/O.

## Dependencies and callers

Imports `os` and `syscall`. Called by `tasks.go`; the alternative implementation is `tasks_windows.go`.
