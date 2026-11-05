package screens

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/theme"
)

type TasksClosedMsg struct{}
type TasksOpenLogMsg struct{ Path string }

// TasksModel is the task monitor opened with `t`. It renders the durable task
// registry: recently finished work first, then whatever is running now. Every
// entry, running or not, has a log that Enter opens.
type TasksModel struct {
	completed, active []data.Task
	width, height     int
	theme             theme.Theme
	cursor            int
}

// completedShown bounds the finished-task history; older records are pruned
// with the rest of logs/dashboard.
const completedShown = 12

func (m *TasksModel) Resize(width, height int) { m.width, m.height = width, height }

func NewTasksModel(t theme.Theme, tasks []data.Task, width, height int) TasksModel {
	m := TasksModel{width: width, height: height, theme: t}
	m.SetTasks(tasks)
	return m
}

// SetTasks refreshes the monitor from a registry snapshot. The screen is
// re-read on entry and on every tick while it is open, so phases and retries
// update live.
func (m *TasksModel) SetTasks(tasks []data.Task) {
	m.completed, m.active = nil, nil
	for _, task := range tasks {
		if task.Active() {
			m.active = append(m.active, task)
		} else if len(m.completed) < completedShown {
			m.completed = append(m.completed, task)
		}
	}
	if m.cursor >= len(m.rows()) {
		m.cursor = max(0, len(m.rows())-1)
	}
}

// rows is the single navigable list, in display order.
func (m TasksModel) rows() []data.Task {
	return append(append([]data.Task{}, m.completed...), m.active...)
}

func (m TasksModel) Update(msg tea.Msg) (TasksModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "q" || msg.String() == "esc" {
			return m, func() tea.Msg { return TasksClosedMsg{} }
		}
		rows := m.rows()
		switch msg.String() {
		case "down", "j":
			if m.cursor < len(rows)-1 {
				m.cursor++
			}
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "enter":
			if m.cursor < len(rows) && rows[m.cursor].Log != "" {
				path := rows[m.cursor].Log
				return m, func() tea.Msg { return TasksOpenLogMsg{Path: path} }
			}
		}
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	}
	return m, nil
}

// taskOutcome is the right-hand column of a finished task.
func taskOutcome(task data.Task) string {
	switch task.State {
	case data.TaskCompleted:
		return "completed"
	case data.TaskFailed:
		return fmt.Sprintf("failed (exit %d)", task.ExitCode)
	case data.TaskInterrupted:
		return "interrupted"
	default:
		// A task log from before the registry existed: the log is all there is.
		return "finished"
	}
}

// taskProgress describes a running task: the phase its worker last reported,
// and the retry it is on.
func taskProgress(task data.Task) string {
	progress := task.Phase
	if progress == "" {
		progress = "running"
	}
	if task.Attempt > 1 {
		progress += fmt.Sprintf(" (retry %d)", task.Attempt-1)
	}
	return progress
}

func (m TasksModel) View() string {
	line := func(task data.Task, index int, right string, stamp time.Time) string {
		marker := "  "
		if index == m.cursor {
			marker = "> "
		}
		name := taskDescription(task.Action, task.Number)
		when := ""
		if !stamp.IsZero() {
			when = "  " + stamp.Format("2006-01-02 15:04:05")
		}
		return marker + name + " — " + right + when
	}
	lines := []string{"TASKS", "", "RECENTLY COMPLETED"}
	if len(m.completed) == 0 {
		lines = append(lines, "  None")
	}
	for i, task := range m.completed {
		lines = append(lines, line(task, i, taskOutcome(task), task.Finished()))
	}
	lines = append(lines, "", "CURRENTLY ACTIVE")
	if len(m.active) == 0 {
		lines = append(lines, "  None")
	}
	for i, task := range m.active {
		lines = append(lines, line(task, len(m.completed)+i, taskProgress(task), task.Started()))
	}
	lines = append(lines, "", "↑↓ navigate · Enter view log · q/Esc return")
	return lipgloss.NewStyle().Foreground(m.theme.Text).Render(strings.Join(lines, "\n"))
}

// taskLabel is the human name of a task action, shared with the pipeline's
// status bar.
func taskLabel(action string) string {
	switch action {
	case "evaluate":
		return "evaluating"
	case "cv":
		return "CV generation"
	case "letter":
		return "cover letter generation"
	case "both":
		return "CV + cover letter generation"
	case "paste-jd":
		return "pasted-JD intake"
	case "scan":
		return "portal scan"
	default:
		return action
	}
}
