# dashboard/internal/data/tasks_windows.go

**Authority:** [tasks_windows.go](../../../../dashboard/internal/data/tasks_windows.go).

Windows process-liveness check for the task registry.

## Inputs

The Windows build selects this file; `processAlive` receives a process ID.

## Outputs and behavior

Reports whether a task's owner still exists. `os.FindProcess` opens the process on Windows and fails once it is gone, so the handle is released immediately and its success is the answer. No file or command I/O.

## Dependencies and callers

Imports `os`. Called by `tasks.go`; the alternative implementation is `tasks_other.go`.
