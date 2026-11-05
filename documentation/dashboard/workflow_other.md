# dashboard/workflow_other.go

**Authority:** [dashboard/workflow_other.go](../../dashboard/workflow_other.go).

Provides the non-Windows process hooks: the window no-op, and detachment for background workers.

## Inputs

The `!windows` build constraint selects this file; `hideWorkflowWindow` and `detachWorkflow` each accept an `exec.Cmd`.

## Outputs and behavior

The window-hiding hook is a no-op on these platforms. `detachWorkflow` puts a launched worker in its own session (`Setsid`), so it outlives the dashboard and never receives the terminal's signals.

## Dependencies and callers

Imports `os/exec` and `syscall`; called by `workflow.go`. Keeps shared workflow code portable.

