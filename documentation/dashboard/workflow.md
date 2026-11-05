# dashboard/workflow.go

**Authority:** [dashboard/workflow.go](../../dashboard/workflow.go).

Builds and executes dashboard-launched Node workflows.

## Inputs

`workflowCommand(root, action, number)` requires a positive permanent ID and maps `evaluate`, `cv` and `letter` to `src/eval/evaluate-jobs.mjs`, `src/cvgen/draft-cv.mjs` and `src/cvgen/draft-cover-letter.mjs`, each with `--job=N`. `workflowTasks` expands the picker's `both` (CV + cover letter) into the `cv` and `letter` tasks: the two artifacts are always separate workers with separate prompts, never one combined call. Pasted-JD submission marshals intake fields, including `force`, to JSON stdin for `src/scan/add-pasted-jd.mjs`. `checkJDURL(root, url)` runs before that submission: it calls `data.CheckURLTracked` directly (no Node launcher) and wraps the result in `screens.PipelineURLCheckedMsg`.

## Outputs and behavior

Runs children with the absolute repository working directory and writes stdout/stderr to private `logs/dashboard/` files. `launchWorkflow` calls `launchTask` once per task of the request, so CV + cover letter starts two workers in parallel, each with its own log and task record; one that cannot start does not stop the other. `launchTask` starts the worker **detached** — its own console and process group — and returns without waiting: a task is not tied to the dashboard that started it and survives quitting, closing the terminal and restarting the dashboard. Before starting, it opens the task log and, once the process exists, writes the task record under `logs/dashboard/tasks/` with the worker's process ID, and passes that record's path in `CAREER_TASK_FILE` so the worker reports its own phase, retries and outcome. Progress and completion are therefore read back from the registry (`internal/data/tasks.go`), not returned here: only a launch that never happened — a rejected action, an unwritable log or record, a process that will not start — produces a `PipelineWorkflowFinishedMsg`. Pasted-JD intake still runs attached, because its one-line summary is its result. `checkJDURL` also runs attached and synchronously within its `tea.Cmd`, since the paste form must not advance past the URL step until PostgreSQL has answered.

## Dependencies and callers

Imports Bubble Tea, screen message types and Go process/JSON/filesystem utilities. Called by `main.go`. Platform-specific `hideWorkflowWindow` is supplied by `workflow_windows.go` or `workflow_other.go`.

