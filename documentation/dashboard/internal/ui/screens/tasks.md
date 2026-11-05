# dashboard/internal/ui/screens/tasks.go

**Authority:** [tasks.go](../../../../../dashboard/internal/ui/screens/tasks.go).

Provides the `t` task monitor.

## Inputs

Takes the theme, terminal size and a task-registry snapshot (`[]data.Task`). `SetTasks` replaces that snapshot; the root application refreshes it when the screen opens and on every tick while it is open.

## Outputs and behavior

Lists the twelve most recently finished tasks first, then everything currently running, newest activity first within each section. A finished task shows its outcome — `completed`, `failed (exit N)`, `interrupted` when its worker died without reporting, or plain `finished` for a task log that predates the registry. A running task shows the phase its worker last reported and, on a second or later attempt, `(retry N)`. Live state comes only from the registry, never from log file sizes or timestamps: a log on disk cannot distinguish a live worker from one that was killed. `Enter` emits `TasksOpenLogMsg` for the selected task's log, including a running task's live log; `q` or `Esc` returns to the pipeline. The cursor is clamped whenever the list changes underneath it.

## Dependencies and callers

Imports Bubble Tea, Lip Gloss, internal data/theme and Go fmt/strings/time. Created and refreshed by `main.go`; task naming (`taskLabel`, `taskDescription`) is shared with the pipeline status bar in screen `workflow.go`.
