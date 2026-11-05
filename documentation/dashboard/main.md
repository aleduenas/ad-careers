# dashboard/main.go

**Authority:** [dashboard/main.go](../../dashboard/main.go).

Runs the Bubble Tea application and connects screen messages to database operations and subprocesses.

## Inputs

Accepts `--path` (default current directory). Loads PostgreSQL applications through `internal/data`, enriches report summaries, and refreshes data every five seconds. Reads `EDITOR` for editable letters.

## Outputs and behavior

Shows pipeline, viewer, progress and task-monitor screens; routes revision-checked status changes and field edits, scans, evaluation/drafting, pasted-JD intake, external artifact opening and letter PDF publishing. `refreshAllowed` is the single gate for every periodic and manual reload: it refreshes only on the pipeline screen, never while an external editor is open (`refreshSuspended`) and never mid-keystroke in a picker or text field (`PipelineModel.RefreshBlocked`). Running tasks never suspend refreshing, so generated artifacts appear as soon as a worker writes them. `syncTasks` re-reads the durable task registry on every five-second tick — and every second while the task monitor is open, so phases and retries update live — which is how the dashboard learns that detached background work progressed, finished or died; it owns no worker and waits for none. Startup loads report summaries for all existing rows. Each five-second refresh preserves cached summaries and loads only newly appearing report paths, so compensation does not depend on highlighting a row. Startup database failures exit; refresh failures display an error while retaining the view. A field edit reports its outcome (saved, or "Edit not saved" with the reason) in the pipeline status bar after the post-edit reload, so the reload cannot erase a rejection.

## Dependencies and callers

The root model loads report-linked JDs from PostgreSQL via `LoadJobDescription`. It saves the report viewer while the JD is open, then restores its scroll position when the JD closes.

Imports Bubble Tea and internal data/model/theme/screens, plus Go OS/process/path/time utilities. Uses `workflow.go` for task execution. Run the built dashboard against the repository root. Publishing requires an `output/.../cover-letter.md` path.
