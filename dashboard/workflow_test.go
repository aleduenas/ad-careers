package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/model"
	"career-ops/dashboard/internal/theme"
	"career-ops/dashboard/internal/ui/screens"
)

func TestWorkflowCommandsUseSelectedIDAndExplicitWorkingDirectory(t *testing.T) {
	root := filepath.Join(t.TempDir(), "repo with spaces & punctuation")
	for _, tt := range []struct{ action, script string }{
		{"evaluate", filepath.Join("src", "eval", "evaluate-jobs.mjs")},
		{"cv", filepath.Join("src", "cvgen", "draft-cv.mjs")},
		{"letter", filepath.Join("src", "cvgen", "draft-cover-letter.mjs")},
	} {
		t.Run(tt.action, func(t *testing.T) {
			cmd, err := workflowCommand(root, tt.action, 967)
			if err != nil {
				t.Fatal(err)
			}
			want := []string{filepath.Join(root, tt.script), "--job=967"}
			if !reflect.DeepEqual(cmd.Args[1:], want) {
				t.Fatalf("args %q; want %q", cmd.Args, want)
			}
			if cmd.Dir != root {
				t.Fatalf("cwd %q; want %q", cmd.Dir, root)
			}
		})
	}
	if _, err := workflowCommand(root, "evaluate", 0); err == nil {
		t.Fatal("invalid ID accepted")
	}
	if _, err := workflowCommand(root, "shell", 12); err == nil {
		t.Fatal("unknown action accepted")
	}
	// CV + cover letter is never one combined command; it expands to both tasks.
	if _, err := workflowCommand(root, "both", 12); err == nil {
		t.Fatal("combined CV + letter command accepted")
	}
	if got := workflowTasks("both"); !reflect.DeepEqual(got, []string{"cv", "letter"}) {
		t.Fatalf("both expands to %q", got)
	}
}

// TestCVAndLetterLaunchAsTwoTasks keeps CV + cover letter as two independent
// workers, each with its own task record and log, rather than one call.
func TestCVAndLetterLaunchAsTwoTasks(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required to launch a workflow")
	}
	root := t.TempDir()
	if cmd := launchWorkflow(root, screens.PipelineRunWorkflowMsg{Action: "both", Number: 1152}); cmd != nil {
		t.Fatalf("a successful launch reports nothing, got %+v", cmd())
	}
	tasks := data.LoadTasks(root)
	actions := map[string]bool{}
	for _, task := range tasks {
		actions[task.Action] = true
		if task.Number != 1152 || task.PID <= 0 {
			t.Fatalf("incomplete task record: %+v", task)
		}
	}
	if len(tasks) != 2 || !actions["cv"] || !actions["letter"] || tasks[0].Log == tasks[1].Log {
		t.Fatalf("expected separate cv and letter tasks, got %+v", tasks)
	}
	// Neither script exists under the temporary root; wait for both workers to
	// exit so the temporary directory can be removed.
	deadline := time.Now().Add(20 * time.Second)
	for {
		tasks = data.LoadTasks(root)
		if !tasks[0].Active() && !tasks[1].Active() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("workers never reconciled: %+v", tasks)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestRefreshPreloadsCompensationForUnselectedJobs(t *testing.T) {
	root := t.TempDir()
	reports := filepath.Join(root, "data", "evaluations")
	if err := os.MkdirAll(reports, 0o755); err != nil {
		t.Fatal(err)
	}
	writeReport := func(name, comp string) string {
		path := filepath.Join(reports, name)
		if err := os.WriteFile(path, []byte("**Compensation band:** "+comp+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			t.Fatal(err)
		}
		return rel
	}

	firstComp := "CAD $100,000-$120,000 base"
	secondComp := "CAD $130,000-$150,000 base"
	first := model.CareerApplication{Number: 1, Company: "First", Role: "Engineer", Status: "Applied", Score: 5, ReportPath: writeReport("first.md", firstComp)}
	pm := screens.NewPipelineModel(theme.NewTheme("catppuccin-mocha"), []model.CareerApplication{first}, model.PipelineMetrics{Total: 1}, root, 200, 40)
	enrichMissingReportSummaries(&pm, []model.CareerApplication{first}, root)

	second := model.CareerApplication{Number: 2, Company: "Second", Role: "Engineer", Status: "Applied", Score: 4, ReportPath: writeReport("second.md", secondComp)}
	apps := []model.CareerApplication{first, second}
	pm = pm.WithReloadedData(apps, model.PipelineMetrics{Total: 2})
	enrichMissingReportSummaries(&pm, apps, root)

	view := pm.View()
	if !strings.Contains(view, firstComp) || !strings.Contains(view, secondComp) {
		t.Fatalf("refresh should show cached and newly loaded compensation without selecting each row: %q", view)
	}
}

// TestLaunchWorkflowDetachesAndRecordsTheTask covers the launch contract: the
// dashboard starts the worker, records it durably with its own process ID and
// task log, and returns without waiting. When the worker dies without
// reporting, the registry reconciles it to interrupted rather than leaving it
// running forever.
func TestLaunchWorkflowDetachesAndRecordsTheTask(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required to launch a workflow")
	}
	root := t.TempDir()
	if cmd := launchWorkflow(root, screens.PipelineRunWorkflowMsg{Action: "cv", Number: 1152}); cmd != nil {
		t.Fatalf("a successful launch reports nothing, got %+v", cmd())
	}
	tasks := data.LoadTasks(root)
	if len(tasks) != 1 {
		t.Fatalf("expected one recorded task, got %+v", tasks)
	}
	task := tasks[0]
	if task.Action != "cv" || task.Number != 1152 || task.PID <= 0 {
		t.Fatalf("incomplete task record: %+v", task)
	}
	if filepath.Dir(task.Log) != filepath.Join(root, "logs", "dashboard") {
		t.Fatalf("task log %q is outside logs/dashboard", task.Log)
	}
	if _, err := os.Stat(task.Log); err != nil {
		t.Fatalf("task log missing: %v", err)
	}
	// The script does not exist under the temporary root, so the worker exits
	// on its own without ever reporting.
	deadline := time.Now().Add(20 * time.Second)
	for {
		state := data.LoadTasks(root)[0].State
		if state == data.TaskInterrupted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("worker never reconciled; state %q", state)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// TestLaunchWorkflowRejectsUnknownActionWithoutRecording keeps argument
// validation ahead of any file, process or registry work.
func TestLaunchWorkflowRejectsUnknownActionWithoutRecording(t *testing.T) {
	root := t.TempDir()
	cmd := launchWorkflow(root, screens.PipelineRunWorkflowMsg{Action: "shell", Number: 5})
	if cmd == nil {
		t.Fatal("unknown action was accepted")
	}
	if msg := cmd().(screens.PipelineWorkflowFinishedMsg); msg.Status == "" {
		t.Fatal("rejected action reported no status")
	}
	if tasks := data.LoadTasks(root); len(tasks) != 0 {
		t.Fatalf("rejected action left records behind: %+v", tasks)
	}
}

// TestLaunchedWorkerReportsProgressThroughItsRecord exercises the whole task
// loop with a stand-in worker: the dashboard launches it detached, the worker
// reports its phase and retry through CAREER_TASK_FILE using the repository's
// own reporting module, and the dashboard reads that progress back out of the
// registry without ever waiting on the process.
func TestLaunchedWorkerReportsProgressThroughItsRecord(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required to launch a workflow")
	}
	reporter, err := filepath.Abs(filepath.Join("..", "src", "lib", "_task-status.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err = os.MkdirAll(filepath.Join(root, "src", "cvgen"), 0o755); err != nil {
		t.Fatal(err)
	}
	release := filepath.Join(root, "release")
	stub := "import { existsSync } from 'node:fs';\n" +
		"import { reportPhase } from " + strconv.Quote("file:///"+filepath.ToSlash(reporter)) + ";\n" +
		"reportPhase('company research', 2);\n" +
		"const wait = setInterval(() => { if (existsSync(" + strconv.Quote(filepath.ToSlash(release)) + ")) { clearInterval(wait); } }, 50);\n"
	if err = os.WriteFile(filepath.Join(root, "src", "cvgen", "draft-cv.mjs"), []byte(stub), 0o644); err != nil {
		t.Fatal(err)
	}

	if cmd := launchWorkflow(root, screens.PipelineRunWorkflowMsg{Action: "cv", Number: 1152}); cmd != nil {
		t.Fatalf("a successful launch reports nothing, got %+v", cmd())
	}
	task := awaitTask(t, root, func(task data.Task) bool {
		return task.State == data.TaskRunning && task.Phase == "company research"
	}, "the worker's reported phase")
	if task.Attempt != 2 {
		t.Fatalf("retry not reported: %+v", task)
	}
	if err = os.WriteFile(release, []byte("go\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	task = awaitTask(t, root, func(task data.Task) bool { return task.State == data.TaskCompleted }, "completion")
	if task.ExitCode != 0 || task.FinishedAt == "" {
		t.Fatalf("incomplete outcome: %+v", task)
	}
}

func awaitTask(t *testing.T, root string, done func(data.Task) bool, what string) data.Task {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		tasks := data.LoadTasks(root)
		if len(tasks) == 1 && done(tasks[0]) {
			return tasks[0]
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s; tasks: %+v", what, tasks)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
