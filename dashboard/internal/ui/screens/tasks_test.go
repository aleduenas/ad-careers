package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/theme"
)

func tasksFixture() TasksModel {
	return NewTasksModel(theme.NewTheme("catppuccin-mocha"), []data.Task{
		{Action: "cv", Number: 1152, State: data.TaskCompleted, Log: "cv.log", FinishedAt: "2026-09-22T15:21:07Z"},
		{Action: "evaluate", Number: 1148, State: data.TaskFailed, ExitCode: 1, Log: "eval.log", FinishedAt: "2026-09-22T14:09:10Z"},
		{Action: "evaluate", Number: 1155, State: data.TaskRunning, Phase: "company research", Attempt: 2, Log: "live.log", StartedAt: "2026-09-22T15:30:00Z"},
	}, 120, 40)
}

// TestTaskMonitorShowsCompletedThenActiveWithProgress covers the monitor's
// contract: finished work on top, live work below it, and a retrying task
// saying so.
func TestTaskMonitorShowsCompletedThenActiveWithProgress(t *testing.T) {
	view := tasksFixture().View()
	completed, active := strings.Index(view, "RECENTLY COMPLETED"), strings.Index(view, "CURRENTLY ACTIVE")
	if completed < 0 || active < 0 || completed > active {
		t.Fatalf("completed tasks must come first:\n%s", view)
	}
	for _, want := range []string{
		"CV generation #1152 — completed",
		"evaluating #1148 — failed (exit 1)",
		"evaluating #1155 — company research (retry 1)",
	} {
		if !strings.Contains(view, want) {
			t.Fatalf("missing %q in:\n%s", want, view)
		}
	}
}

// TestTaskMonitorOpensTheSelectedLog covers navigation across both sections.
func TestTaskMonitorOpensTheSelectedLog(t *testing.T) {
	m := tasksFixture()
	var cmd tea.Cmd
	if m, cmd = m.Update(runeKey("j")); cmd != nil {
		t.Fatalf("navigation emitted %T", cmd())
	}
	if m, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter}); cmd == nil {
		t.Fatal("Enter did not open the selected log")
	}
	if msg := cmd().(TasksOpenLogMsg); msg.Path != "eval.log" {
		t.Fatalf("opened %q; want the second completed task's log", msg.Path)
	}
	// The third row is the running task: its live log opens the same way.
	m, _ = m.Update(runeKey("j"))
	_, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if msg := cmd().(TasksOpenLogMsg); msg.Path != "live.log" {
		t.Fatalf("opened %q; want the running task's log", msg.Path)
	}
}

// TestTaskMonitorRefreshKeepsTheCursorInRange guards live refresh: the list
// changes under the cursor every second while the screen is open.
func TestTaskMonitorRefreshKeepsTheCursorInRange(t *testing.T) {
	m := tasksFixture()
	for i := 0; i < 5; i++ {
		m, _ = m.Update(runeKey("j"))
	}
	m.SetTasks([]data.Task{{Action: "cv", Number: 1152, State: data.TaskCompleted, Log: "cv.log"}})
	if m.cursor != 0 {
		t.Fatalf("cursor %d is outside the refreshed list", m.cursor)
	}
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter}); cmd == nil {
		t.Fatal("Enter stopped working after a refresh")
	}
}
