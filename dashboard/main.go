package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/model"
	"career-ops/dashboard/internal/theme"
	"career-ops/dashboard/internal/ui/screens"
)

type viewState int

const (
	viewPipeline viewState = iota
	viewReport
	viewProgress
	viewTasks
)

type appModel struct {
	pipeline        screens.PipelineModel
	viewer          screens.ViewerModel
	viewerParent    *screens.ViewerModel // report to restore after viewing its JD
	progress        screens.ProgressModel
	state           viewState
	databaseError   string
	careerOpsPath   string
	theme           theme.Theme
	progressMetrics model.ProgressMetrics
	tasks           screens.TasksModel
	// refreshSuspended covers tasks owned by the root model, such as an
	// external editor launched from the pipeline screen.
	refreshSuspended bool
	// viewerReturn is the screen the file viewer was opened from.
	viewerReturn viewState
}

func enrichMissingReportSummaries(pm *screens.PipelineModel, apps []model.CareerApplication, careerOpsPath string) {
	for _, app := range apps {
		if app.ReportPath == "" || pm.HasReportSummary(app.ReportPath) {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(careerOpsPath, app.ReportPath)
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			pm.EnrichReport(app.ReportPath, archetype, tldr, remote, comp)
		}
	}
}

func (m *appModel) reloadPipelineData() {
	if !m.refreshAllowed() {
		return
	}
	apps, err := data.LoadApplications(m.careerOpsPath)
	if err != nil {
		m.databaseError = err.Error()
		return
	}
	m.databaseError = ""
	metrics := data.ComputeMetrics(apps)
	m.progressMetrics = data.ComputeProgressMetrics(apps)
	m.pipeline = m.pipeline.WithReloadedData(apps, metrics)
	enrichMissingReportSummaries(&m.pipeline, apps, m.careerOpsPath)
}

// refreshAllowed is the one gate for all periodic and manual data reloads.
// Keeping this at the root prevents new screens/features from accidentally
// reintroducing destructive model replacement during user interaction.
func (m appModel) refreshAllowed() bool {
	return m.state == viewPipeline && !m.refreshSuspended && !m.pipeline.RefreshBlocked()
}

// syncTasks refreshes the pipeline (and, when open, the monitor) from the
// durable task registry. Workers are detached, so this is the only way the
// dashboard learns that background work progressed, finished or died.
func (m *appModel) syncTasks() {
	m.pipeline.SyncTasks(data.LoadTasks(m.careerOpsPath))
	if m.state == viewTasks {
		m.tasks.SetTasks(m.pipeline.Tasks())
	}
}

func (m *appModel) showJD(jobID int, path, title, jobURL string) {
	content, err := data.LoadJobDescription(m.careerOpsPath, jobID)
	if err != nil {
		content = "Database JD error: " + err.Error()
	}
	m.viewer = screens.NewContentViewerModel(m.theme, path, title,
		screens.ViewerArtifacts{JobURL: jobURL}, m.pipeline.Width(), m.pipeline.Height(),
		strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n"))
}

type databaseTick time.Time
type tasksTick time.Time

func nextTasksTick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tasksTick(t) })
}

func nextDatabaseTick() tea.Cmd {
	return tea.Tick(5*time.Second, func(t time.Time) tea.Msg { return databaseTick(t) })
}
func (m appModel) Init() tea.Cmd { return nextDatabaseTick() }

func (m appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case databaseTick:
		m.syncTasks()
		if m.refreshAllowed() {
			m.reloadPipelineData()
		}
		return m, nextDatabaseTick()

	case tasksTick:
		// The monitor follows live work, so it refreshes faster than the
		// pipeline and only while it is on screen.
		if m.state != viewTasks {
			return m, nil
		}
		m.syncTasks()
		return m, nextTasksTick()
	case tea.WindowSizeMsg:
		m.pipeline.Resize(msg.Width, msg.Height)
		if m.state == viewReport {
			m.viewer.Resize(msg.Width, msg.Height)
		}
		if m.state == viewProgress {
			m.progress.Resize(msg.Width, msg.Height)
		}
		if m.state == viewTasks {
			m.tasks.Resize(msg.Width, msg.Height)
			return m, nil
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineLoadReportMsg:
		archetype, tldr, remote, comp := data.LoadReportSummary(msg.CareerOpsPath, msg.ReportPath)
		m.pipeline.EnrichReport(msg.ReportPath, archetype, tldr, remote, comp)
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		err := data.UpdateApplicationStatus(msg.CareerOpsPath, msg.App, msg.NewStatus)
		if err != nil {
			// Log the error but still reload data to keep UI consistent
			fmt.Fprintf(os.Stderr, "WARN: status update failed: %v\n", err)
		}
		m.reloadPipelineData()
		if err != nil {
			m.databaseError = err.Error()
		}
		return m, nil

	case screens.PipelineRefreshMsg:
		if m.refreshAllowed() {
			m.reloadPipelineData()
		}
		return m, nil

	case screens.PipelineDiscardMsg:
		err := data.DiscardApplication(msg.CareerOpsPath, msg.App, msg.Reason)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARN: discard failed: %v\n", err)
		}
		m.reloadPipelineData()
		if err != nil {
			m.databaseError = err.Error()
		}
		return m, nil

	case screens.PipelineEditJobMsg:
		err := data.UpdateJobField(msg.CareerOpsPath, msg.App, msg.Field, msg.Value)
		m.reloadPipelineData()
		// Report after the reload: a successful reload clears databaseError, which
		// used to erase a rejected edit before it was ever drawn.
		if err != nil {
			m.pipeline.SetStatus(fmt.Sprintf("Edit not saved: %v", err))
		} else {
			m.pipeline.SetStatus(fmt.Sprintf("Saved %s for #%d", msg.Field, msg.App.Number))
		}
		return m, nil

	case screens.PipelineEditJDMsg:
		m.refreshSuspended = true
		return m, editJDFileCmd(msg.CareerOpsPath, msg.App)

	case pipelineJDEditDoneMsg:
		m.refreshSuspended = false
		if msg.Err == nil {
			if err := data.SyncEditedJD(msg.CareerOpsPath, msg.App); err != nil {
				m.databaseError = err.Error()
			}
		} else {
			m.databaseError = msg.Err.Error()
		}
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineOpenReportMsg:
		m.viewerParent = nil
		m.viewerReturn = viewPipeline
		if msg.JDJobID != 0 {
			m.showJD(msg.JDJobID, msg.Path, msg.Title, msg.JobURL)
			m.state = viewReport
			return m, func() tea.Msg { return tea.ClearScreen() }
		}
		m.viewer = screens.NewViewerModel(
			m.theme,
			msg.Path, msg.Title,
			screens.ViewerArtifacts{
				JobURL:     msg.JobURL,
				JDJobID:    msg.ReportJDJobID,
				JDPath:     msg.ReportJDPath,
				CVPath:     msg.CVPath,
				LetterPath: msg.LetterPath,
				BriefPath:  msg.BriefPath,
				PrepPath:   msg.PrepPath,
			},
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.ViewerOpenJDMsg:
		parent := m.viewer
		m.viewerParent = &parent
		m.showJD(msg.JobID, msg.Path, msg.Title, msg.JobURL)
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.ViewerOpenPrepMsg:
		m.viewer = screens.NewViewerModel(
			m.theme,
			msg.Path, msg.Title, screens.ViewerArtifacts{},
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.ViewerOpenBriefMsg:
		m.viewer = screens.NewViewerModel(
			m.theme,
			msg.Path, msg.Title, screens.ViewerArtifacts{},
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.ViewerOpenLetterMsg:
		if strings.EqualFold(filepath.Ext(msg.Path), ".md") {
			m.viewer = screens.NewViewerModel(
				m.theme,
				msg.Path, msg.Title, screens.ViewerArtifacts{},
				m.pipeline.Width(), m.pipeline.Height(),
			)
			m.state = viewReport
			return m, func() tea.Msg { return tea.ClearScreen() }
		}
		return m, openExternalTarget(msg.Path)

	case screens.ViewerOpenCVMsg:
		return m, openExternalTarget(msg.Path)

	case screens.ViewerOpenURLMsg:
		return m, openExternalTarget(msg.URL)

	case screens.ViewerEditMsg:
		return m, editFileCmd(msg.Path)

	case screens.ViewerPublishPDFMsg:
		return m, publishCoverLetterCmd(m.careerOpsPath, msg.Path)

	case screens.ViewerClosedMsg:
		if m.viewerParent != nil {
			m.viewer = *m.viewerParent
			m.viewerParent = nil
			return m, func() tea.Msg { return tea.ClearScreen() }
		}
		// A log opened from the task monitor returns to it, so several logs can
		// be read in a row.
		if m.viewerReturn == viewTasks {
			m.viewerReturn = viewPipeline
			m.state = viewTasks
			m.syncTasks()
			return m, tea.Batch(func() tea.Msg { return tea.ClearScreen() }, nextTasksTick())
		}
		m.state = viewPipeline
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.PipelineOpenProgressMsg:
		m.progress = screens.NewProgressModel(
			theme.NewTheme("catppuccin-mocha"),
			m.progressMetrics,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewProgress
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.ProgressClosedMsg:
		m.state = viewPipeline
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.TasksClosedMsg:
		m.state = viewPipeline
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.PipelineOpenTasksMsg:
		m.pipeline.SyncTasks(data.LoadTasks(m.careerOpsPath))
		m.tasks = screens.NewTasksModel(m.theme, m.pipeline.Tasks(), m.pipeline.Width(), m.pipeline.Height())
		m.state = viewTasks
		return m, tea.Batch(func() tea.Msg { return tea.ClearScreen() }, nextTasksTick())

	case screens.TasksOpenLogMsg:
		m.viewer = screens.NewViewerModel(m.theme, msg.Path, "Task log", screens.ViewerArtifacts{}, m.pipeline.Width(), m.pipeline.Height())
		m.viewerReturn = viewTasks
		m.state = viewReport
		return m, func() tea.Msg { return tea.ClearScreen() }

	case screens.PipelineRunScanMsg:
		path := m.careerOpsPath
		return m, func() tea.Msg {
			cmd := exec.Command("node", "src/scan/scan.mjs")
			cmd.Dir = path
			output, err := cmd.CombinedOutput()
			return screens.PipelineScanFinishedMsg{Output: string(output), Err: err}
		}

	case screens.PipelineScanFinishedMsg:
		m.pipeline.FinishScan(msg.Output, msg.Err)
		m.reloadPipelineData()
		return m, nil
	case screens.PipelineRunWorkflowMsg:
		return m, launchWorkflow(m.careerOpsPath, msg)
	case screens.PipelineSubmitJDMsg:
		return m, runJDSubmit(m.careerOpsPath, msg)
	case screens.PipelineCheckURLMsg:
		return m, checkJDURL(m.careerOpsPath, msg.URL)
	case screens.PipelineWorkflowFinishedMsg:
		m.pipeline.FinishWorkflow(msg.Action, msg.Number, msg.Status, msg.LogPath)
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineOpenURLMsg:
		return m, openExternalTarget(msg.URL)

	default:
		if m.state == viewReport {
			vm, cmd := m.viewer.Update(msg)
			m.viewer = vm
			return m, cmd
		}
		if m.state == viewProgress {
			pg, cmd := m.progress.Update(msg)
			m.progress = pg
			return m, cmd
		}
		if m.state == viewTasks {
			tasks, cmd := m.tasks.Update(msg)
			m.tasks = tasks
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd
	}
}

// editFileCmd suspends the TUI and hands the terminal to the user's editor
// (via tea.ExecProcess, so raw terminal mode is restored correctly on
// return), then reports back so the viewer can reload the file from disk.
func editFileCmd(path string) tea.Cmd {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		if runtime.GOOS == "windows" {
			editor = "notepad"
		} else {
			editor = "vi"
		}
	}
	parts := strings.Fields(editor)
	cmd := exec.Command(parts[0], append(parts[1:], path)...)
	return tea.ExecProcess(cmd, func(err error) tea.Msg {
		return screens.ViewerEditDoneMsg{Path: path, Err: err}
	})
}

type pipelineJDEditDoneMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	Err           error
}

func editJDFileCmd(root string, app model.CareerApplication) tea.Cmd {
	if app.JDPath == "" {
		return func() tea.Msg {
			return pipelineJDEditDoneMsg{CareerOpsPath: root, App: app, Err: fmt.Errorf("#%d has no cached job description file", app.Number)}
		}
	}
	editor := os.Getenv("EDITOR")
	if editor == "" {
		if runtime.GOOS == "windows" {
			editor = "notepad"
		} else {
			editor = "vi"
		}
	}
	parts := strings.Fields(editor)
	if len(parts) == 0 {
		return func() tea.Msg {
			return pipelineJDEditDoneMsg{CareerOpsPath: root, App: app, Err: fmt.Errorf("EDITOR is empty")}
		}
	}
	args := append(parts[1:], filepath.Join(root, app.JDPath))
	return tea.ExecProcess(exec.Command(parts[0], args...), func(err error) tea.Msg {
		return pipelineJDEditDoneMsg{CareerOpsPath: root, App: app, Err: err}
	})
}

// publishCoverLetterCmd renders only an already user-edited cover-letter.md.
// Generation remains separate; its audit artifacts are never involved here.
func publishCoverLetterCmd(root, path string) tea.Cmd {
	return func() tea.Msg {
		absoluteRoot, err := filepath.Abs(root)
		if err != nil {
			return screens.ViewerPublishPDFDoneMsg{Err: err}
		}
		absolutePath, err := filepath.Abs(path)
		if err != nil {
			return screens.ViewerPublishPDFDoneMsg{Err: err}
		}
		outputRoot := filepath.Join(absoluteRoot, "output")
		rel, err := filepath.Rel(outputRoot, absolutePath)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || !strings.EqualFold(filepath.Base(absolutePath), "cover-letter.md") {
			return screens.ViewerPublishPDFDoneMsg{Err: fmt.Errorf("cover-letter source must be an output/.../cover-letter.md file")}
		}
		cmd := exec.Command("node", filepath.Join(absoluteRoot, "src", "cvgen", "publish-cover-letter.mjs"), absolutePath)
		cmd.Dir = absoluteRoot
		output, err := cmd.CombinedOutput()
		if err != nil {
			return screens.ViewerPublishPDFDoneMsg{Output: string(output), Err: err}
		}
		return screens.ViewerPublishPDFDoneMsg{PDFPath: filepath.Join(filepath.Dir(absolutePath), "cover-letter.pdf"), Output: string(output)}
	}
}

func openExternalTarget(target string) tea.Cmd {
	return func() tea.Msg {
		var cmd *exec.Cmd
		switch runtime.GOOS {
		case "darwin":
			cmd = exec.Command("open", target)
		case "linux":
			cmd = exec.Command("xdg-open", target)
		case "windows":
			// rundll32 receives argv directly (no cmd.exe shell parsing), so
			// paths/URLs containing "&" remain a single argument.
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
		default:
			cmd = exec.Command("xdg-open", target)
		}
		_ = cmd.Run()
		return nil
	}
}

func (m appModel) View() string {
	if m.databaseError != "" {
		return "Database error: " + m.databaseError + "\nRetrying every 5 seconds.\n" + m.pipeline.View()
	}
	switch m.state {
	case viewReport:
		return m.viewer.View()
	case viewProgress:
		return m.progress.View()
	case viewTasks:
		return m.tasks.View()
	default:
		return m.pipeline.View()
	}
}

func main() {
	pathFlag := flag.String("path", ".", "Path to career-ops directory")
	flag.Parse()

	careerOpsPath := *pathFlag

	// Load applications
	apps, err := data.LoadApplications(careerOpsPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Database error: %v\n", err)
		os.Exit(1)
	}

	// Compute metrics
	metrics := data.ComputeMetrics(apps)
	progressMetrics := data.ComputeProgressMetrics(apps)

	// Load report summaries once so compensation is visible before a row is selected.
	t := theme.NewTheme("auto")
	pm := screens.NewPipelineModel(t, apps, metrics, careerOpsPath, 120, 40)
	enrichMissingReportSummaries(&pm, apps, careerOpsPath)

	m := appModel{
		pipeline:        pm,
		careerOpsPath:   careerOpsPath,
		theme:           t,
		progressMetrics: progressMetrics,
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
