package screens

import (
	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/model"
	"career-ops/dashboard/internal/theme"
	tea "github.com/charmbracelet/bubbletea"
	"strings"
	"testing"
)

func workflowFixture(t *testing.T, pending bool) PipelineModel {
	t.Helper()
	app := model.CareerApplication{Number: 967, Company: "Acme", Role: "Engineer", Status: "Evaluated", ReportPath: "reports/967.md", IsPending: pending}
	m := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), []model.CareerApplication{app}, model.PipelineMetrics{}, t.TempDir(), 120, 40)
	filter := filterEvaluated
	if pending {
		filter = filterPending
	}
	m.activeTab = tabIndexForFilter(t, filter)
	m.applyFilterAndSort()
	return m
}
func runeKey(s string) tea.KeyMsg { return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)} }

func TestEvaluateHotkeyStartsSelectedJobAndPreventsDuplicateLaunch(t *testing.T) {
	m := workflowFixture(t, true)
	if !strings.Contains(m.renderHelp(), "evaluate") {
		t.Fatal("missing footer action")
	}
	m, cmd := m.Update(runeKey("v"))
	if cmd == nil {
		t.Fatal("no evaluation command")
	}
	msg := cmd().(PipelineRunWorkflowMsg)
	if msg.Number != 967 || msg.Action != "evaluate" {
		t.Fatalf("wrong request: %+v", msg)
	}
	var repeat tea.Cmd
	if m, repeat = m.Update(runeKey("v")); repeat != nil {
		t.Fatal("duplicate evaluation launch allowed during workflow")
	}
	m = m.WithReloadedData(m.apps, m.metrics)
	if !m.evaluateJobs[967] {
		t.Fatal("refresh lost running state")
	}
	m.FinishWorkflow("evaluate", 967, "Completed", "task.log")
	m = m.WithReloadedData(m.apps, m.metrics)
	if len(m.evaluateJobs) != 0 || m.workflowLog != "task.log" {
		t.Fatal("completion state lost")
	}
	_, cmd = m.Update(runeKey("t"))
	if _, ok := cmd().(PipelineOpenTasksMsg); !ok {
		t.Fatal("t should open the task monitor")
	}
}

func TestDraftPickerRoutesEachDeliverable(t *testing.T) {
	for i, action := range []string{"cv", "letter", "both"} {
		m := workflowFixture(t, false)
		m, cmd := m.Update(runeKey("d"))
		if cmd != nil || !m.draftPicker {
			t.Fatal("d must open picker before launch")
		}
		for n := 0; n < i; n++ {
			m, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
		}
		m, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
		if cmd == nil {
			t.Fatal("no drafting command")
		}
		req := cmd().(PipelineRunWorkflowMsg)
		if req.Action != action || req.Number != 967 {
			t.Fatalf("wrong draft request %+v", req)
		}
		if m.draftPicker || m.draftRunning[967] != action {
			t.Fatal("incorrect running state")
		}
	}
	m := workflowFixture(t, false)
	m, _ = m.Update(runeKey("d"))
	m, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if m.draftPicker || cmd != nil {
		t.Fatal("cancel launched work")
	}
}

func TestDraftPickerSurvivesPeriodicDataRefresh(t *testing.T) {
	m := workflowFixture(t, false)
	m, _ = m.Update(runeKey("d"))
	if !m.draftPicker {
		t.Fatal("draft picker did not open")
	}
	m.draftCursor = 2
	reloaded := m.WithReloadedData(m.apps, m.metrics)
	if !reloaded.draftPicker {
		t.Fatal("periodic refresh closed the draft picker")
	}
	if reloaded.draftCursor != 2 {
		t.Fatalf("draft cursor changed across refresh: got %d, want 2", reloaded.draftCursor)
	}
}

func TestPipelineInteractionsSurvivePeriodicDataRefresh(t *testing.T) {
	m := workflowFixture(t, false)
	m.statusPicker, m.statusCursor = true, 3
	m.discardPicker, m.discardCursor = true, 2
	m.searchInput, m.searchQuery = true, "security"
	m.jdPasteStage = "text"
	m.jdPasteURL = "https://example.test/job"
	m.jdPasteCompany = "Acme"
	m.jdCompanyCursor = 1
	m.jdPasteRole = "Engineer"
	m.jdPasteText = "job description"
	reloaded := m.WithReloadedData(m.apps, m.metrics)
	if !reloaded.statusPicker || reloaded.statusCursor != 3 {
		t.Fatal("status picker state was lost during refresh")
	}
	if !reloaded.discardPicker || reloaded.discardCursor != 2 {
		t.Fatal("discard picker state was lost during refresh")
	}
	if !reloaded.searchInput || reloaded.searchQuery != "security" {
		t.Fatal("search state was lost during refresh")
	}
	if reloaded.jdPasteStage != "text" || reloaded.jdPasteURL != m.jdPasteURL || reloaded.jdPasteText != m.jdPasteText {
		t.Fatal("manual JD state was lost during refresh")
	}
}

func TestRefreshBlockedCoversEveryInteractivePipelineState(t *testing.T) {
	cases := []struct {
		name string
		set  func(*PipelineModel)
	}{
		{"status picker", func(m *PipelineModel) { m.statusPicker = true }},
		{"discard picker", func(m *PipelineModel) { m.discardPicker = true }},
		{"edit picker", func(m *PipelineModel) { m.editPicker = true }},
		{"edit input", func(m *PipelineModel) { m.editInput = true }},
		{"search input", func(m *PipelineModel) { m.searchInput = true }},
		{"draft picker", func(m *PipelineModel) { m.draftPicker = true }},
		{"jd paste", func(m *PipelineModel) { m.jdPasteStage = "text" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := workflowFixture(t, false)
			tc.set(&m)
			if !m.RefreshBlocked() {
				t.Fatalf("RefreshBlocked() = false for %s", tc.name)
			}
		})
	}
}

// TestRunningTasksNeverBlockRefresh pins the rule that broke the pipeline view
// once before: a task that is running — or one whose worker died without
// reporting completion — must not stop the dashboard from reloading, or newly
// generated artifacts never appear.
func TestRunningTasksNeverBlockRefresh(t *testing.T) {
	m := workflowFixture(t, false)
	m.evaluateJobs[967] = true
	m.draftRunning[967] = "cv"
	if m.RefreshBlocked() {
		t.Fatal("running tasks must not block refresh")
	}
}

// TestSyncTasksDrivesRunningStateFromTheRegistry covers the task contract:
// detached workers are tracked through their records, a completion is
// announced once, and a worker that died without reporting stops counting as
// running instead of pinning the pipeline forever.
func TestSyncTasksDrivesRunningStateFromTheRegistry(t *testing.T) {
	m := workflowFixture(t, false)
	running := data.Task{Action: "cv", Number: 1152, State: data.TaskRunning, Phase: "drafting worksheet", Attempt: 2, Record: "r1", Log: "task.log"}
	m.SyncTasks([]data.Task{running})
	if m.draftRunning[1152] != "cv" || !m.anyRunning() {
		t.Fatalf("registry task not tracked: %+v", m.draftRunning)
	}
	if status := m.statusBarText(); !strings.Contains(status, "retry 1") || !strings.Contains(status, "drafting worksheet") {
		t.Fatalf("status bar lost phase/retry: %q", status)
	}
	done := running
	done.State, done.ExitCode = data.TaskCompleted, 0
	m.SyncTasks([]data.Task{done})
	if len(m.draftRunning) != 0 {
		t.Fatalf("completed task still running: %+v", m.draftRunning)
	}
	if !strings.Contains(m.workflowStatus, "#1152") {
		t.Fatalf("completion not announced: %q", m.workflowStatus)
	}
	// A record that was already finished when the dashboard started must not be
	// announced again.
	m.workflowStatus = ""
	m.SyncTasks([]data.Task{done})
	if m.workflowStatus != "" {
		t.Fatalf("re-announced an old completion: %q", m.workflowStatus)
	}
	// An interrupted worker clears the same way a clean exit does.
	m.SyncTasks([]data.Task{running})
	lost := running
	lost.State = data.TaskInterrupted
	m.SyncTasks([]data.Task{lost})
	if m.anyRunning() || !strings.Contains(m.workflowStatus, "interrupted") {
		t.Fatalf("interrupted task not cleared: running=%v status=%q", m.anyRunning(), m.workflowStatus)
	}
}

// TestQuitIsNeverBlockedByBackgroundWork pins that detached tasks do not hold
// the dashboard open.
func TestQuitIsNeverBlockedByBackgroundWork(t *testing.T) {
	m := workflowFixture(t, false)
	m.SyncTasks([]data.Task{{Action: "evaluate", Number: 967, State: data.TaskRunning, Record: "r1"}})
	_, cmd := m.Update(runeKey("q"))
	if cmd == nil {
		t.Fatal("quit was blocked while a background task was running")
	}
	if _, ok := cmd().(PipelineClosedMsg); !ok {
		t.Fatalf("expected the pipeline to close, got %T", cmd())
	}
}

// TestConcurrentWorkflowsAcrossJobs documents the concurrency contract: jobs
// in both task families can run together, while a duplicate launch against
// the same job in the same family is a no-op.
func TestConcurrentWorkflowsAcrossJobs(t *testing.T) {
	appA := model.CareerApplication{Number: 967, Company: "Acme", Role: "Engineer", Status: "Evaluated", ReportPath: "reports/967.md"}
	appB := model.CareerApplication{Number: 968, Company: "Globex", Role: "Analyst", Status: "Evaluated", ReportPath: "reports/968.md"}
	pending := model.CareerApplication{Number: 969, Company: "Initech", Role: "Dev", IsPending: true}
	pendingB := model.CareerApplication{Number: 970, Company: "Umbrella", Role: "Developer", IsPending: true}
	m := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), []model.CareerApplication{appA, appB, pending, pendingB}, model.PipelineMetrics{}, t.TempDir(), 120, 40)

	m, cmd := m.startWorkflow("evaluate", 969)
	if cmd == nil || !m.evaluateJobs[969] {
		t.Fatal("evaluate did not start")
	}
	m, cmd = m.startWorkflow("evaluate", 970)
	if cmd == nil || !m.evaluateJobs[970] || len(m.evaluateJobs) != 2 {
		t.Fatal("second concurrent evaluation was blocked")
	}
	m, cmd = m.startWorkflow("evaluate", 969)
	if cmd != nil {
		t.Fatal("duplicate evaluation launch against the same job should be a no-op")
	}

	m, cmd = m.startWorkflow("cv", 967)
	if cmd == nil {
		t.Fatal("draft for a different job blocked by an in-flight evaluate")
	}
	if m.draftRunning[967] != "cv" {
		t.Fatal("draft not tracked as running")
	}

	m, cmd = m.startWorkflow("letter", 968)
	if cmd == nil {
		t.Fatal("second concurrent draft for a different job was blocked")
	}
	if len(m.draftRunning) != 2 {
		t.Fatalf("expected 2 concurrent drafts, got %+v", m.draftRunning)
	}

	m, cmd = m.startWorkflow("both", 967)
	if cmd != nil {
		t.Fatal("duplicate draft launch against the same job should be a no-op")
	}

	m.FinishWorkflow("cv", 967, "done", "")
	if len(m.evaluateJobs) != 2 || m.draftRunning[968] != "letter" {
		t.Fatal("finishing one job's draft must not disturb the other running jobs")
	}
	if _, stillThere := m.draftRunning[967]; stillThere {
		t.Fatal("finished draft not cleared")
	}

	m.FinishWorkflow("evaluate", 969, "done", "evaluation-969.log")
	if m.evaluateJobs[969] || !m.evaluateJobs[970] {
		t.Fatal("finishing one evaluation disturbed another running evaluation")
	}
	if status := m.statusBarText(); !strings.Contains(status, "evaluating #970") {
		t.Fatalf("remaining evaluation not shown after out-of-order completion: %q", status)
	}
}

func TestStatusBarListsEveryConcurrentWorkflowInStableOrder(t *testing.T) {
	m := workflowFixture(t, false)
	m.evaluateJobs[970] = true
	m.evaluateJobs[969] = true
	m.draftRunning[968] = "letter"
	m.draftRunning[967] = "cv"

	got := m.statusBarText()
	want := "Running: evaluating #969 · evaluating #970 · CV generation #967 · cover letter generation #968"
	if !strings.HasPrefix(got, want) {
		t.Fatalf("status bar = %q; want prefix %q", got, want)
	}
}

func TestWorkflowHotkeysLaunchConcurrentJobs(t *testing.T) {
	uiTheme := theme.NewTheme("catppuccin-mocha")
	pending := []model.CareerApplication{
		{Number: 969, Company: "Initech", Role: "Developer", IsPending: true},
		{Number: 970, Company: "Umbrella", Role: "Engineer", IsPending: true},
	}
	m := NewPipelineModel(uiTheme, pending, model.PipelineMetrics{}, t.TempDir(), 120, 40)
	m.activeTab = tabIndexForFilter(t, filterPending)
	m.applyFilterAndSort()

	var cmd tea.Cmd
	m, cmd = m.Update(runeKey("v"))
	if cmd == nil {
		t.Fatal("first evaluation hotkey did not launch")
	}
	first := cmd().(PipelineRunWorkflowMsg).Number
	m, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m, cmd = m.Update(runeKey("v"))
	if cmd == nil {
		t.Fatal("second evaluation hotkey was blocked")
	}
	second := cmd().(PipelineRunWorkflowMsg).Number
	if first == second || len(m.evaluateJobs) != 2 {
		t.Fatalf("evaluation hotkeys did not track two jobs: first=%d second=%d running=%v", first, second, m.evaluateJobs)
	}

	evaluated := []model.CareerApplication{
		{Number: 967, Company: "Acme", Role: "Engineer", Status: "Evaluated", ReportPath: "reports/967.md"},
		{Number: 968, Company: "Globex", Role: "Analyst", Status: "Evaluated", ReportPath: "reports/968.md"},
	}
	m = NewPipelineModel(uiTheme, evaluated, model.PipelineMetrics{}, t.TempDir(), 120, 40)
	m.activeTab = tabIndexForFilter(t, filterEvaluated)
	m.applyFilterAndSort()

	m, _ = m.Update(runeKey("d"))
	m, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("first drafting hotkey did not launch")
	}
	first = cmd().(PipelineRunWorkflowMsg).Number
	m, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m, _ = m.Update(runeKey("d"))
	m, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("second drafting hotkey was blocked")
	}
	second = cmd().(PipelineRunWorkflowMsg).Number
	if first == second || len(m.draftRunning) != 2 {
		t.Fatalf("drafting hotkeys did not track two jobs: first=%d second=%d running=%v", first, second, m.draftRunning)
	}
}

func TestWorkflowHotkeysRespectTabAndSearch(t *testing.T) {
	m := workflowFixture(t, true)
	m, cmd := m.Update(runeKey("d"))
	if cmd != nil || m.draftPicker {
		t.Fatal("draft available for pending")
	}
	m = workflowFixture(t, false)
	_, cmd = m.Update(runeKey("e"))
	if cmd != nil {
		t.Fatal("evaluation available outside pending")
	}
	m.searchInput = true
	m, cmd = m.Update(runeKey("d"))
	if cmd != nil || m.draftPicker || m.searchQuery != "d" {
		t.Fatal("typing triggered workflow")
	}
	m = workflowFixture(t, true)
	m.filtered = nil
	_, cmd = m.Update(runeKey("e"))
	if cmd != nil {
		t.Fatal("empty selection launched")
	}
}
