package data

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Task is one dashboard-launched background job. Records live under
// logs/dashboard/tasks/ and outlive both the worker and the dashboard: workers
// run detached, so a record plus the liveness of its owning process is the only
// authority on what is still running. The dashboard writes a record once at
// launch; the worker is its only writer afterwards (src/lib/_task-status.mjs).
type Task struct {
	Action     string `json:"action"`
	Number     int    `json:"number"`
	PID        int    `json:"pid"`
	Log        string `json:"log"`
	State      string `json:"state"`
	Phase      string `json:"phase"`
	Attempt    int    `json:"attempt"`
	StartedAt  string `json:"started_at"`
	UpdatedAt  string `json:"updated_at"`
	FinishedAt string `json:"finished_at"`
	ExitCode   int    `json:"exit_code"`
	// Record is the record's own path and is never serialized.
	Record string `json:"-"`
}

// Task states. A worker reports running/completed/failed itself; interrupted is
// decided by the reader when a running record has no live owner, and unrecorded
// covers a task log with no record at all.
const (
	TaskRunning     = "running"
	TaskCompleted   = "completed"
	TaskFailed      = "failed"
	TaskInterrupted = "interrupted"
	TaskUnrecorded  = "unrecorded"
)

// abandonedAfter bounds how long a record may claim to be running. It guards
// against a recycled process ID outliving the worker that recorded it; real
// tasks finish in minutes.
const abandonedAfter = 24 * time.Hour

// TasksDir is the task registry directory.
func TasksDir(root string) string { return filepath.Join(root, "logs", "dashboard", "tasks") }

func (t Task) Active() bool { return t.State == TaskRunning }

// Started and Finished parse the recorded timestamps, returning the zero time
// when a stamp is missing or malformed.
func (t Task) Started() time.Time  { return parseStamp(t.StartedAt) }
func (t Task) Finished() time.Time { return parseStamp(t.FinishedAt) }

func parseStamp(value string) time.Time {
	stamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return stamp.Local()
}

// WriteTask stores a record atomically, so a reader never sees a partial one.
func WriteTask(task Task) error {
	if err := os.MkdirAll(filepath.Dir(task.Record), 0700); err != nil {
		return err
	}
	encoded, err := json.Marshal(task)
	if err != nil {
		return err
	}
	temporary := task.Record + ".tmp"
	if err = os.WriteFile(temporary, encoded, 0600); err != nil {
		return err
	}
	return os.Rename(temporary, task.Record)
}

// LoadTasks returns every known task, newest activity first, with running
// records reconciled against their owner. Task logs with no record at all are
// reported as unrecorded so history from before the registry stays visible.
func LoadTasks(root string) []Task {
	tasks := []Task{}
	recorded := map[string]bool{}
	entries, _ := os.ReadDir(TasksDir(root))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(TasksDir(root), entry.Name())
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var task Task
		if err = json.Unmarshal(content, &task); err != nil {
			continue
		}
		task.Record = path
		if task.Log != "" {
			recorded[task.Log] = true
		}
		if task.State == TaskRunning && !taskOwnerAlive(task) {
			task.State = TaskInterrupted
		}
		tasks = append(tasks, task)
	}
	tasks = append(tasks, unrecordedLogs(root, recorded)...)
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].when().After(tasks[j].when()) })
	return tasks
}

// when is the task's most recent activity, used for ordering.
func (t Task) when() time.Time {
	for _, stamp := range []string{t.FinishedAt, t.UpdatedAt, t.StartedAt} {
		if parsed := parseStamp(stamp); !parsed.IsZero() {
			return parsed
		}
	}
	return time.Time{}
}

func taskOwnerAlive(task Task) bool {
	started := task.Started()
	if !started.IsZero() && time.Since(started) > abandonedAfter {
		return false
	}
	return processAlive(task.PID)
}

func unrecordedLogs(root string, recorded map[string]bool) []Task {
	logs := []Task{}
	directory := filepath.Join(root, "logs", "dashboard")
	entries, _ := os.ReadDir(directory)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		if recorded[path] {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		action, number := parseTaskLogName(entry.Name())
		logs = append(logs, Task{
			Action:     action,
			Number:     number,
			Log:        path,
			State:      TaskUnrecorded,
			FinishedAt: info.ModTime().Format(time.RFC3339),
		})
	}
	return logs
}

// parseTaskLogName splits "<action>-<number>-<date>-<time>-<random>.log", and
// the numberless form used by tasks that are not tied to one job.
func parseTaskLogName(name string) (string, int) {
	fields := strings.Split(strings.TrimSuffix(name, ".log"), "-")
	if len(fields) < 4 {
		return name, 0
	}
	fields = fields[:len(fields)-3]
	number := 0
	if len(fields) > 1 {
		if parsed, err := strconv.Atoi(fields[len(fields)-1]); err == nil {
			number = parsed
			fields = fields[:len(fields)-1]
		}
	}
	return strings.Join(fields, "-"), number
}
