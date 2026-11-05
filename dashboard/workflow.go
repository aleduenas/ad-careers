package main

import (
	"bytes"
	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/ui/screens"
	"encoding/json"
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func workflowCommand(root, action string, number int) (*exec.Cmd, error) {
	if number <= 0 {
		return nil, fmt.Errorf("a permanent job ID is required")
	}
	var script string
	switch action {
	case "evaluate":
		script = filepath.Join("src", "eval", "evaluate-jobs.mjs")
	case "cv":
		script = filepath.Join("src", "cvgen", "draft-cv.mjs")
	case "letter":
		script = filepath.Join("src", "cvgen", "draft-cover-letter.mjs")
	default:
		return nil, fmt.Errorf("unknown workflow %q", action)
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command("node", filepath.Join(absolute, script), "--job="+strconv.Itoa(number))
	cmd.Dir = absolute
	detachWorkflow(cmd)
	return cmd, nil
}

// workflowTasks expands a requested action into the tasks it launches. CV +
// cover letter is two independent workers with their own prompts, never one
// combined call: a single worker drafting both overfit the letter to the CV.
func workflowTasks(action string) []string {
	if action == "both" {
		return []string{"cv", "letter"}
	}
	return []string{action}
}

// launchWorkflow starts each task of a request (see workflowTasks); a task
// that cannot start does not stop the others.
func launchWorkflow(root string, request screens.PipelineRunWorkflowMsg) tea.Cmd {
	var failures []tea.Cmd
	for _, action := range workflowTasks(request.Action) {
		failures = append(failures, launchTask(root, action, request.Number))
	}
	return tea.Batch(failures...)
}

// launchTask starts a Node worker detached from the dashboard: the worker
// survives quitting, and the dashboard neither waits for it nor owns it. The
// task record written here (and updated by the worker through CAREER_TASK_FILE)
// is what the pipeline and the task monitor read back, so progress and outcome
// survive a dashboard restart. Only a failure to start produces a message.
func launchTask(root, action string, number int) tea.Cmd {
	failed := func(status string) tea.Cmd {
		return func() tea.Msg {
			return screens.PipelineWorkflowFinishedMsg{Action: action, Number: number, Status: status}
		}
	}
	cmd, err := workflowCommand(root, action, number)
	if err != nil {
		return failed(err.Error())
	}
	stamp := time.Now().Format("20060102-150405")
	dir := filepath.Join(cmd.Dir, "logs", "dashboard")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return failed("Cannot create task logs: " + err.Error())
	}
	file, err := os.CreateTemp(dir, fmt.Sprintf("%s-%d-%s-*.log", action, number, stamp))
	if err != nil {
		return failed("Cannot open task log: " + err.Error())
	}
	defer file.Close()
	task := data.Task{
		Action:    action,
		Number:    number,
		Log:       file.Name(),
		State:     data.TaskRunning,
		Phase:     "starting",
		Attempt:   1,
		StartedAt: time.Now().Format(time.RFC3339),
		Record: filepath.Join(data.TasksDir(cmd.Dir),
			fmt.Sprintf("%s-%d-%s-%d.json", action, number, stamp, time.Now().UnixNano())),
	}
	cmd.Stdout = file
	cmd.Stderr = file
	cmd.Env = append(os.Environ(), "CAREER_TASK_FILE="+task.Record)
	if err = cmd.Start(); err != nil {
		return failed(fmt.Sprintf("%s #%d failed to start: %v", action, number, err))
	}
	// The record is only useful once the worker exists to own it.
	task.PID = cmd.Process.Pid
	if err = data.WriteTask(task); err != nil {
		return failed("Cannot record task: " + err.Error())
	}
	// Nothing waits on the worker; releasing it keeps no handle behind.
	go func() { _ = cmd.Wait() }()
	return nil
}

// runJDSubmit hands user-supplied JD intake fields to src/scan/add-pasted-jd.mjs
// via stdin (JSON). The script allocates the permanent pipeline ID and saves
// the JD body verbatim. Stdout's one-line summary becomes the
// status message; full stdout+stderr goes to the same task-log mechanism
// used by runWorkflow, so failures are inspectable with the "t" hotkey.
func runJDSubmit(root string, request screens.PipelineSubmitJDMsg) tea.Cmd {
	return func() tea.Msg {
		result := screens.PipelineWorkflowFinishedMsg{Action: "jd-submit"}
		absolute, err := filepath.Abs(root)
		if err != nil {
			result.Status = err.Error()
			return result
		}

		payload, err := json.Marshal(struct {
			URL     string `json:"url"`
			Company string `json:"company"`
			Role    string `json:"role"`
			Text    string `json:"text"`
			Force   bool   `json:"force"`
		}{URL: request.URL, Company: request.Company, Role: request.Role, Text: request.Text, Force: request.Force})
		if err != nil {
			result.Status = "Cannot encode pasted JD: " + err.Error()
			return result
		}

		cmd := exec.Command("node", filepath.Join(absolute, "src", "scan", "add-pasted-jd.mjs"))
		cmd.Dir = absolute
		cmd.Stdin = bytes.NewReader(payload)
		hideWorkflowWindow(cmd)

		dir := filepath.Join(absolute, "logs", "dashboard")
		if err = os.MkdirAll(dir, 0700); err != nil {
			result.Status = "Cannot create task logs: " + err.Error()
			return result
		}
		file, err := os.CreateTemp(dir, fmt.Sprintf("paste-jd-%s-*.log", time.Now().Format("20060102-150405")))
		if err != nil {
			result.Status = "Cannot open task log: " + err.Error()
			return result
		}
		result.LogPath = file.Name()

		var stdout bytes.Buffer
		cmd.Stdout = io.MultiWriter(file, &stdout)
		cmd.Stderr = file
		err = cmd.Run()
		file.Close()

		if err != nil {
			result.Status = "Paste JD failed: " + strings.TrimSpace(err.Error()) + " — t: task log"
			return result
		}
		summary := strings.TrimSpace(stdout.String())
		if summary == "" {
			summary = "Pasted JD processed"
		}
		result.Status = summary + " — t: task log"
		return result
	}
}

// checkJDURL asks PostgreSQL, directly (not through a launcher), whether a
// pasted-JD URL is already a tracked job or was merely noticed by a past scan.
// This runs synchronously inside the returned tea.Cmd's goroutine, so it
// blocks that step of the paste flow — not the UI — until the query returns.
func checkJDURL(root, url string) tea.Cmd {
	return func() tea.Msg {
		status, err := data.CheckURLTracked(root, url)
		return screens.PipelineURLCheckedMsg{URL: url, Err: err, URLTrackStatus: status}
	}
}
