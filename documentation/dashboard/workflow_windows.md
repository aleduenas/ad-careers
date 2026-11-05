# dashboard/workflow_windows.go

**Authority:** [dashboard/workflow_windows.go](../../dashboard/workflow_windows.go).

Windows process attributes for launched children: hidden consoles, and detachment for background workers.

## Inputs

The Windows build selects this file; `hideWorkflowWindow` and `detachWorkflow` each receive an `exec.Cmd`.

## Outputs and behavior

`hideWorkflowWindow` hides the console of a child the dashboard waits for. `detachWorkflow` additionally sets CREATE_NO_WINDOW and CREATE_NEW_PROCESS_GROUP, so a background worker owns a console that is never displayed and never receives the terminal's Ctrl+C or close events: tasks must outlive the dashboard that started them. DETACHED_PROCESS would detach it equally well, but a process with no console at all makes Windows allocate a fresh one for every child it spawns, flashing a terminal window on the desktop whenever a worker runs the PDF renderer, git or a subscription CLI. No standalone command or file I/O.

## Dependencies and callers

Used by `workflow.go`; imports `os/exec` and `syscall`. The alternative implementation is `workflow_other.go`.

