# dashboard/internal/ui/screens/workflow.go

**Authority:** [dashboard/internal/ui/screens/workflow.go](../../../../../dashboard/internal/ui/screens/workflow.go).

Projects the durable task registry onto the pipeline's per-job task state, and implements the draft-deliverable picker.

## Inputs

Accepts evaluate/cv/letter/both actions and permanent job IDs, plus registry snapshots (`[]data.Task`) from the root application. Maintains separate per-job evaluation and drafting maps; there is no singleton current-task field.

## Outputs and behavior

Emits task requests and rejects duplicate tasks for the same job within each task family; a launch marks the job as running immediately, before the first sync sees its record. `SyncTasks` then rebuilds both maps from the registry, because workers are detached and their records — not this process — are the authority on what is running. It announces each task that stopped since the previous sync exactly once, whatever ended it (completed, failed, or interrupted when its worker died), and clears the report cache so new artifacts are not hidden behind a cached preview. `taskDescription` is the shared wording used by the status bar, the monitor and completion messages. `FinishWorkflow` remains for the tasks the dashboard owns itself: pasted-JD intake and a worker that could not be started at all. `SetStatus` shows a one-line outcome such as a saved or rejected field edit; like other workflow statuses it survives refreshes and yields to the running-task line.

## Dependencies and callers

Imports Bubble Tea, Lip Gloss, internal data, fmt and strings. Used by `pipeline.go`, `tasks.go` and `main.go` message handling; detached process execution lives in `dashboard/workflow.go` and the registry in `internal/data/tasks.go`. CV output-folder locks provide an additional backend guard.
