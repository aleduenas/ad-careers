package screens

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"career-ops/dashboard/internal/data"
)

type PipelineRunWorkflowMsg struct {
	Action string
	Number int
}
type PipelineWorkflowFinishedMsg struct {
	Action  string
	Number  int
	Status  string
	LogPath string
}

var draftOptions = []struct{ label, action string }{
	{"CV", "cv"}, {"Cover letter", "letter"}, {"CV + cover letter", "both"},
}

// startWorkflow tracks evaluation and drafting work per job.
func (m PipelineModel) startWorkflow(action string, number int) (PipelineModel, tea.Cmd) {
	if action == "evaluate" {
		if m.evaluateJobs[number] {
			return m, nil
		}
		if m.evaluateJobs == nil {
			m.evaluateJobs = make(map[int]bool)
		}
		m.evaluateJobs[number] = true
	} else {
		if m.draftRunning == nil {
			m.draftRunning = make(map[int]string)
		}
		if _, busy := m.draftRunning[number]; busy {
			return m, nil
		}
		m.draftRunning[number] = action
	}
	m.workflowLog = ""
	m.workflowStatus = fmt.Sprintf("Started %s for #%d — it runs in the background; t: tasks", action, number)
	return m, func() tea.Msg { return PipelineRunWorkflowMsg{Action: action, Number: number} }
}

// taskDescription names a task the way the status bar and the task monitor
// both say it, for example "evaluating #1152" or "CV generation #1152".
func taskDescription(action string, number int) string {
	if number <= 0 {
		return taskLabel(action)
	}
	return fmt.Sprintf("%s #%d", taskLabel(action), number)
}

// taskKey identifies one in-flight task. Evaluation and drafting for the same
// job run in different families and can therefore overlap.
func taskKey(action string, number int) string { return fmt.Sprintf("%s#%d", action, number) }

// SyncTasks rebuilds the running-task view from the durable task registry,
// which is the only authority on background work: workers are detached, so
// tasks outlive the dashboard and a task that dies must not leave the pipeline
// believing it still runs. It also announces tasks that finished since the
// previous sync — tasks already finished when this dashboard started are not
// re-announced.
func (m *PipelineModel) SyncTasks(tasks []data.Task) {
	evaluating, drafting := map[int]bool{}, map[int]string{}
	running, byKey := map[string]bool{}, map[string]data.Task{}
	for _, task := range tasks {
		if !task.Active() {
			continue
		}
		running[task.Record] = true
		byKey[taskKey(task.Action, task.Number)] = task
		if task.Action == "evaluate" {
			evaluating[task.Number] = true
		} else if task.Number > 0 {
			drafting[task.Number] = task.Action
		}
	}
	for _, task := range tasks {
		if task.Active() || !m.runningTasks[task.Record] {
			continue
		}
		m.workflowStatus = finishedTaskStatus(task)
		m.workflowLog = task.Log
		// New artifacts must not be hidden behind an earlier cached preview.
		m.reportCache = make(map[string]reportSummary)
	}
	// Launches are recorded before the first sync sees them, so anything the
	// registry no longer lists as running has genuinely stopped.
	m.evaluateJobs, m.draftRunning = evaluating, drafting
	m.runningTasks, m.taskByKey, m.taskRecords = running, byKey, tasks
}

// finishedTaskStatus is the pipeline status line for a task that has just
// stopped running, whatever ended it.
func finishedTaskStatus(task data.Task) string {
	name := taskDescription(task.Action, task.Number)
	switch task.State {
	case data.TaskCompleted:
		if task.Action == "evaluate" {
			return fmt.Sprintf("Evaluation #%d complete — tracker refreshed; t: tasks", task.Number)
		}
		return fmt.Sprintf("Drafts for #%d ready — review the generated files; t: tasks", task.Number)
	case data.TaskInterrupted:
		return fmt.Sprintf("%s was interrupted — its worker is gone; t: tasks", name)
	default:
		return fmt.Sprintf("%s failed (exit %d) — t: tasks", name, task.ExitCode)
	}
}

// Tasks returns the last synced registry snapshot for the task monitor.
func (m PipelineModel) Tasks() []data.Task { return m.taskRecords }

// SetStatus shows a one-line outcome, such as a saved or rejected edit, in the
// pipeline status bar. It survives refreshes like any other workflow status.
func (m *PipelineModel) SetStatus(status string) {
	m.workflowStatus = status
	m.workflowLog = ""
}

// FinishWorkflow reports a task the dashboard itself owns: pasted-JD intake,
// and a worker that could not be started at all.
func (m *PipelineModel) FinishWorkflow(action string, number int, status, log string) {
	switch action {
	case "evaluate":
		delete(m.evaluateJobs, number)
	case "jd-submit":
		m.jdSubmitting = false
	default:
		delete(m.draftRunning, number)
	}
	m.workflowStatus = status
	m.workflowLog = log
	// A new report must not reuse an earlier cached preview.
	m.reportCache = make(map[string]reportSummary)
}

func (m PipelineModel) handleDraftPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.draftPicker = false
	case "up", "k":
		if m.draftCursor > 0 {
			m.draftCursor--
		}
	case "down", "j":
		if m.draftCursor < len(draftOptions)-1 {
			m.draftCursor++
		}
	case "enter":
		m.draftPicker = false
		if app, ok := m.CurrentApp(); ok && app.Number > 0 {
			if _, busy := m.draftRunning[app.Number]; !busy {
				return m.startWorkflow(draftOptions[m.draftCursor].action, app.Number)
			}
		}
	}
	return m, nil
}

func (m PipelineModel) renderDraftPicker() string {
	app, _ := m.CurrentApp()
	lines := []string{fmt.Sprintf("Generate for #%d — %s", app.Number, app.Company), "Existing files for this role will be regenerated.", ""}
	for i, opt := range draftOptions {
		prefix := "  "
		if i == m.draftCursor {
			prefix = "> "
		}
		lines = append(lines, prefix+opt.label)
	}
	return lipgloss.NewStyle().Padding(0, 2).Foreground(m.theme.Text).Render(strings.Join(lines, "\n"))
}
