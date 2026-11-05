package data

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeRecord(t *testing.T, root string, task Task) Task {
	t.Helper()
	task.Record = filepath.Join(TasksDir(root), task.Action+"-"+time.Now().Format("150405.000000000")+".json")
	if err := WriteTask(task); err != nil {
		t.Fatal(err)
	}
	return task
}

// TestLoadTasksReconcilesRunningRecordsAgainstTheirOwner is the heart of the
// registry: because workers are detached, a record that claims to be running is
// only believed while the process that owns it is alive.
func TestLoadTasksReconcilesRunningRecordsAgainstTheirOwner(t *testing.T) {
	root := t.TempDir()
	now := time.Now().Format(time.RFC3339)
	writeRecord(t, root, Task{Action: "cv", Number: 1152, PID: os.Getpid(), State: TaskRunning, Phase: "drafting", Attempt: 2, StartedAt: now})
	writeRecord(t, root, Task{Action: "evaluate", Number: 900, PID: 2147483646, State: TaskRunning, StartedAt: now})
	writeRecord(t, root, Task{Action: "both", Number: 800, PID: os.Getpid(), State: TaskRunning, StartedAt: time.Now().Add(-48 * time.Hour).Format(time.RFC3339)})
	writeRecord(t, root, Task{Action: "letter", Number: 700, PID: os.Getpid(), State: TaskCompleted, FinishedAt: now})

	states := map[int]string{}
	for _, task := range LoadTasks(root) {
		states[task.Number] = task.State
	}
	if states[1152] != TaskRunning {
		t.Fatalf("live worker not running: %q", states[1152])
	}
	if states[900] != TaskInterrupted {
		t.Fatalf("dead worker still running: %q", states[900])
	}
	// A recycled process ID must not resurrect a day-old record.
	if states[800] != TaskInterrupted {
		t.Fatalf("abandoned record still running: %q", states[800])
	}
	if states[700] != TaskCompleted {
		t.Fatalf("finished task was reconciled: %q", states[700])
	}
}

// TestLoadTasksKeepsUnrecordedLogsAndOrdersByActivity covers task logs written
// before the registry existed, and the newest-first ordering the monitor shows.
func TestLoadTasksKeepsUnrecordedLogsAndOrdersByActivity(t *testing.T) {
	root := t.TempDir()
	logs := filepath.Join(root, "logs", "dashboard")
	if err := os.MkdirAll(logs, 0o755); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(logs, "evaluate-1148-20260921-101500-42.log")
	if err := os.WriteFile(orphan, []byte("older run\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(orphan, time.Now().Add(-time.Hour), time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	tracked := filepath.Join(logs, "cv-1152-20260922-152107-7.log")
	if err := os.WriteFile(tracked, []byte("tracked run\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeRecord(t, root, Task{Action: "cv", Number: 1152, Log: tracked, State: TaskCompleted, FinishedAt: time.Now().Format(time.RFC3339)})

	tasks := LoadTasks(root)
	if len(tasks) != 2 {
		t.Fatalf("expected the record plus one unrecorded log, got %+v", tasks)
	}
	if tasks[0].Number != 1152 || tasks[0].State != TaskCompleted {
		t.Fatalf("newest task is not first: %+v", tasks[0])
	}
	if tasks[1].Number != 1148 || tasks[1].Action != "evaluate" || tasks[1].State != TaskUnrecorded {
		t.Fatalf("unrecorded log not reported: %+v", tasks[1])
	}
	// A log that belongs to a record must never be listed twice.
	for _, task := range tasks {
		if task.State == TaskUnrecorded && task.Log == tracked {
			t.Fatal("recorded log duplicated as unrecorded")
		}
	}
}

// TestWriteTaskIsAtomic pins that readers never see a partial record.
func TestWriteTaskIsAtomic(t *testing.T) {
	root := t.TempDir()
	task := writeRecord(t, root, Task{Action: "cv", Number: 1, PID: os.Getpid(), State: TaskRunning, StartedAt: time.Now().Format(time.RFC3339)})
	content, err := os.ReadFile(task.Record)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Task
	if err = json.Unmarshal(content, &decoded); err != nil {
		t.Fatalf("record is not valid JSON: %v", err)
	}
	if decoded.Record != "" {
		t.Fatal("the record's own path must not be serialized")
	}
	if entries, _ := os.ReadDir(TasksDir(root)); len(entries) != 1 {
		t.Fatalf("temporary file left behind: %+v", entries)
	}
}
