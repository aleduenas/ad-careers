package screens

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"career-ops/dashboard/internal/data"
	"career-ops/dashboard/internal/model"
	"career-ops/dashboard/internal/theme"
)

// PipelineClosedMsg is emitted when the pipeline screen is dismissed.
type PipelineClosedMsg struct{}

// PipelineOpenReportMsg is emitted when a report should be opened in FileViewer.
type PipelineOpenReportMsg struct {
	JDJobID       int
	ReportJDJobID int // associated JD for a non-Pending report, if cached
	ReportJDPath  string
	Path          string
	Title         string
	JobURL        string
	CVPath        string // absolute path to CV HTML/PDF, or "" if none
	LetterPath    string // absolute path to cover letter, or "" if none
	BriefPath     string // absolute path to cover-letter brief markdown, or "" if none
	PrepPath      string // absolute path to interview-prep markdown, or "" if none
}

// PipelineOpenURLMsg is emitted when a job URL should be opened in browser.
type PipelineOpenURLMsg struct {
	URL string
}

// PipelineLoadReportMsg requests lazy loading of a report summary.
type PipelineLoadReportMsg struct {
	CareerOpsPath string
	ReportPath    string
}

// PipelineUpdateStatusMsg requests a status update for an application.
type PipelineUpdateStatusMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
}

// PipelineDiscardMsg requests an item be discarded, logged with a reason so
// it stays traceable in the tracker.
type PipelineDiscardMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	Reason        string
}

// PipelineEditJobMsg requests an editable metadata change.
type PipelineEditJobMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	Field         string
	Value         string
}

// PipelineEditJDMsg requests opening the selected JD in the external editor.
type PipelineEditJDMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
}

// PipelineRefreshMsg requests a full tracker reload from disk.
type PipelineRefreshMsg struct{}

// PipelineOpenProgressMsg is emitted when the progress screen should open.
type PipelineOpenProgressMsg struct{}

// PipelineOpenTasksMsg opens the durable task monitor.
type PipelineOpenTasksMsg struct{}

// PipelineRunScanMsg requests that the portal scan script be run to look
// for new postings. Emitted from the PENDING tab only.
type PipelineRunScanMsg struct{}

// PipelineScanFinishedMsg reports completion of the scan script, carrying
// its combined stdout/stderr and any process error for summarization.
type PipelineScanFinishedMsg struct {
	Output string
	Err    error
}

type reportSummary struct {
	archetype string
	tldr      string
	remote    string
	comp      string
}

// Sort modes
const (
	sortScore   = "score"
	sortStatus  = "status" // evaluated/applied/... date; labelled per tab by sortLabel
	sortAdded   = "added"
	sortCompany = "company"
)

// Filter modes
const (
	filterAll       = "all"
	filterEvaluated = "evaluated"
	filterApplied   = "applied"
	filterInterview = "interview"
	filterGhosted   = "ghosted"
	filterRejected  = "rejected"
	filterDiscarded = "discarded"
	filterTop       = "top"
	filterPending   = "pending"
)

type pipelineTab struct {
	filter string
	label  string
}

var pipelineTabs = []pipelineTab{
	{filterAll, "ALL"},
	{filterPending, "PENDING"},
	{filterEvaluated, "EVALUATED"},
	{filterApplied, "APPLIED"},
	{filterInterview, "INTERVIEW"},
	{filterGhosted, "GHOSTED"},
	{filterTop, "TOP ≥4"},
	{filterRejected, "REJECTED"},
	{filterDiscarded, "DISCARDED"},
}

// Status is not a sort option: grouped view and the filter tabs already order by status.
// Pending rows have no status date, so the Pending tab skips sortStatus.
var sortCycle = []string{sortScore, sortStatus, sortAdded, sortCompany}

var statusOptions = []string{"Applied", "Rejected", "Interview", "Offer", "Pending", "Evaluated"}

// discardReasons are the required reasons offered whenever a job is discarded.
var discardReasons = []string{
	"Expired",
	"Seniority mismatch",
	"Wrong role",
	"Wrong location",
	"Duplicate",
	"Other",
}

// PipelineModel implements the career pipeline dashboard screen.
type PipelineModel struct {
	apps          []model.CareerApplication
	filtered      []model.CareerApplication
	metrics       model.PipelineMetrics
	cursor        int
	scrollOffset  int
	sortMode      string
	activeTab     int
	viewMode      string // "grouped" or "flat"
	width, height int
	theme         theme.Theme
	careerOpsPath string
	reportCache   map[string]reportSummary
	// Status picker sub-state
	statusPicker bool
	statusCursor int
	// Discard-reason picker sub-state
	discardPicker bool
	discardCursor int
	editPicker    bool
	editCursor    int
	editInput     bool
	editValue     string
	editField     string
	// Search sub-state — narrows the active tab by substring on company/role/notes.
	searchInput bool   // true while the user is typing the query
	searchQuery string // committed (or in-progress) lowercased query
	// Scan sub-state — tracks the async node src/scan/scan.mjs run triggered
	// from the PENDING tab.
	scanning   bool
	scanStatus string
	// Running operations survive refresh; duplicate work is tracked per job.
	evaluateJobs map[int]bool
	jdSubmitting bool
	// draftRunning tracks in-flight cv/letter/both drafts by job number, so
	// multiple different roles can draft concurrently while still preventing
	// a duplicate launch against the same job's output folder.
	draftRunning map[int]string
	// Durable task-registry state: the last snapshot, the records that were
	// running at the previous sync (so completions are announced once), and the
	// running task per action/job for progress display.
	taskRecords    []data.Task
	runningTasks   map[string]bool
	taskByKey      map[string]data.Task
	workflowStatus string
	workflowLog    string
	draftPicker    bool
	draftCursor    int
	// Paste-JD sub-state — a three-step flow (URL, role, JD text) triggered from
	// the PENDING tab that submits the pasted job description for scripted
	// formatting. jdPasteStage is "" (inactive), "url", "role", or "text".
	jdPasteStage    string
	jdPasteURL      string
	jdPasteCompany  string
	jdCompanyCursor int
	jdPasteRole     string
	jdPasteText     string
	// URL dedup sub-state — a PostgreSQL check runs before the URL step can
	// advance; jdForceDuplicate carries a user's "continue anyway" past a
	// scan-only match into the eventual PipelineSubmitJDMsg.
	jdURLChecking      bool
	jdForceDuplicate   bool
	jdDupJobNumber     int
	jdDupJobCompany    string
	jdDupJobRole       string
	jdDupJobStatus     string
	jdDupScanCompany   string
	jdDupScanTitle     string
	jdDupScanStatus    string
	jdDupScanFirstSeen string
}

// NewPipelineModel creates a new pipeline screen.
func NewPipelineModel(t theme.Theme, apps []model.CareerApplication, metrics model.PipelineMetrics, careerOpsPath string, width, height int) PipelineModel {
	m := PipelineModel{
		apps:          apps,
		metrics:       metrics,
		sortMode:      sortScore,
		activeTab:     0,
		viewMode:      "grouped",
		width:         width,
		height:        height,
		theme:         t,
		careerOpsPath: careerOpsPath,
		reportCache:   make(map[string]reportSummary),
		evaluateJobs:  make(map[int]bool),
		draftRunning:  make(map[int]string),
		runningTasks:  make(map[string]bool),
		taskByKey:     make(map[string]data.Task),
	}
	m.applyFilterAndSort()
	return m
}

// pipelineBusy reports running work for quit protection and status display.
func (m PipelineModel) pipelineBusy() bool {
	return m.scanning || len(m.evaluateJobs) > 0 || m.jdSubmitting
}

// anyRunning reports whether any child process (pipeline-mutating or draft)
// is still running — used to keep 'q' from killing in-flight work.
func (m PipelineModel) anyRunning() bool {
	return m.pipelineBusy() || len(m.draftRunning) > 0
}

// RefreshBlocked is the single refresh-safety boundary for the pipeline UI. A
// reload rebuilds the model, so it is deferred while the user is mid-keystroke
// in a picker or text field. Running tasks deliberately do NOT block refresh:
// WithReloadedData carries in-flight state across, and a task that completes
// or dies must never be able to freeze the pipeline view.
func (m PipelineModel) RefreshBlocked() bool {
	return m.statusPicker ||
		m.discardPicker ||
		m.editPicker ||
		m.editInput ||
		m.searchInput ||
		m.draftPicker ||
		m.jdPasteStage != ""
}

// statusBarText returns the line to show above the body. Active work always
// takes precedence over the last completion message so an out-of-order task
// completion cannot make another in-flight task disappear from the UI.
func (m PipelineModel) statusBarText() string {
	var running []string
	evaluationNumbers := make([]int, 0, len(m.evaluateJobs))
	for number := range m.evaluateJobs {
		evaluationNumbers = append(evaluationNumbers, number)
	}
	sort.Ints(evaluationNumbers)
	for _, number := range evaluationNumbers {
		running = append(running, m.describeRunning("evaluate", number))
	}
	nums := make([]int, 0, len(m.draftRunning))
	for n := range m.draftRunning {
		nums = append(nums, n)
	}
	sort.Ints(nums)
	for _, n := range nums {
		running = append(running, m.describeRunning(m.draftRunning[n], n))
	}
	if len(running) > 0 {
		return "Running: " + strings.Join(running, " · ") + " — t: tasks"
	}
	return m.workflowStatus
}

// describeRunning names a running task and, when the worker has reported one,
// the phase it is in and the attempt it is on.
func (m PipelineModel) describeRunning(action string, number int) string {
	label := taskDescription(action, number)
	task, ok := m.taskByKey[taskKey(action, number)]
	if !ok {
		return label
	}
	if task.Attempt > 1 {
		label += fmt.Sprintf(" (retry %d)", task.Attempt-1)
	}
	if task.Phase != "" {
		label += ": " + task.Phase
	}
	return label
}

// Init implements tea.Model.
func (m PipelineModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *PipelineModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Width returns the current width.
func (m PipelineModel) Width() int { return m.width }

// Height returns the current height.
func (m PipelineModel) Height() int { return m.height }

// CopyReportCache copies the report cache from another pipeline model.
func (m *PipelineModel) CopyReportCache(other *PipelineModel) {
	for k, v := range other.reportCache {
		m.reportCache[k] = v
	}
}

// EnrichReport caches report summary data for preview.
func (m *PipelineModel) EnrichReport(reportPath, archetype, tldr, remote, comp string) {
	m.reportCache[reportPath] = reportSummary{
		archetype: archetype,
		tldr:      tldr,
		remote:    remote,
		comp:      comp,
	}
}

// HasReportSummary reports whether a report path is already cached. The root
// application uses this during periodic refreshes to load only newly appearing
// reports while keeping cursor-driven preview loading asynchronous.
func (m PipelineModel) HasReportSummary(reportPath string) bool {
	summary, ok := m.reportCache[reportPath]
	// A summary without compensation violates the evaluation contract and must
	// be retried on refresh rather than preserved as a permanent blank cache hit.
	return ok && summary.comp != ""
}

// WithReloadedData rebuilds the pipeline with fresh tracker data while preserving
// the current UI state so manual refresh feels seamless.
func (m PipelineModel) WithReloadedData(apps []model.CareerApplication, metrics model.PipelineMetrics) PipelineModel {
	selectedReportPath := ""
	selectedCompany := ""
	selectedRole := ""
	if app, ok := m.CurrentApp(); ok {
		selectedReportPath = app.ReportPath
		selectedCompany = app.Company
		selectedRole = app.Role
	}

	reloaded := NewPipelineModel(m.theme, apps, metrics, m.careerOpsPath, m.width, m.height)
	reloaded.sortMode = m.sortMode
	reloaded.activeTab = m.activeTab
	reloaded.viewMode = m.viewMode
	// Preserve every transient interaction across the periodic database refresh;
	// rebuilding the model must never cancel an active picker or editor.
	reloaded.statusPicker = m.statusPicker
	reloaded.statusCursor = m.statusCursor
	reloaded.discardPicker = m.discardPicker
	reloaded.discardCursor = m.discardCursor
	// Preserve search state across refresh — otherwise pressing `r` silently drops a
	// committed query and the user loses their place mid-investigation.
	reloaded.searchQuery = m.searchQuery
	reloaded.searchInput = m.searchInput
	// Preserve scan status/in-flight state — a refresh triggered by the scan
	// finishing (or a manual `r`) shouldn't wipe the result the user just saw.
	reloaded.scanning = m.scanning
	reloaded.scanStatus = m.scanStatus
	reloaded.evaluateJobs = m.evaluateJobs
	reloaded.jdSubmitting = m.jdSubmitting
	// Periodic database refreshes must not close the editor or discard input.
	reloaded.jdPasteStage = m.jdPasteStage
	reloaded.jdPasteURL = m.jdPasteURL
	reloaded.jdPasteCompany = m.jdPasteCompany
	reloaded.jdCompanyCursor = m.jdCompanyCursor
	reloaded.jdPasteRole = m.jdPasteRole
	reloaded.jdPasteText = m.jdPasteText
	reloaded.jdURLChecking = m.jdURLChecking
	reloaded.jdForceDuplicate = m.jdForceDuplicate
	reloaded.jdDupJobNumber = m.jdDupJobNumber
	reloaded.jdDupJobCompany = m.jdDupJobCompany
	reloaded.jdDupJobRole = m.jdDupJobRole
	reloaded.jdDupJobStatus = m.jdDupJobStatus
	reloaded.jdDupScanCompany = m.jdDupScanCompany
	reloaded.jdDupScanTitle = m.jdDupScanTitle
	reloaded.jdDupScanStatus = m.jdDupScanStatus
	reloaded.jdDupScanFirstSeen = m.jdDupScanFirstSeen
	reloaded.draftRunning = m.draftRunning
	reloaded.taskRecords = m.taskRecords
	reloaded.runningTasks = m.runningTasks
	reloaded.taskByKey = m.taskByKey
	reloaded.draftPicker = m.draftPicker
	reloaded.draftCursor = m.draftCursor
	reloaded.workflowStatus = m.workflowStatus
	reloaded.workflowLog = m.workflowLog
	reloaded.applyFilterAndSort()
	reloaded.CopyReportCache(&m)

	for i, app := range reloaded.filtered {
		if selectedReportPath != "" && app.ReportPath == selectedReportPath {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
		if selectedReportPath == "" && app.Company == selectedCompany && app.Role == selectedRole {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
	}

	if len(reloaded.filtered) == 0 {
		reloaded.cursor = 0
		reloaded.scrollOffset = 0
		return reloaded
	}

	if m.cursor >= len(reloaded.filtered) {
		reloaded.cursor = len(reloaded.filtered) - 1
	} else if m.cursor > 0 {
		reloaded.cursor = m.cursor
	}
	reloaded.adjustScroll()
	return reloaded
}

// CurrentApp returns the currently selected application, if any.
func (m PipelineModel) CurrentApp() (model.CareerApplication, bool) {
	if m.cursor < 0 || m.cursor >= len(m.filtered) {
		return model.CareerApplication{}, false
	}
	return m.filtered[m.cursor], true
}

// Update handles input for the pipeline screen.
func (m PipelineModel) Update(msg tea.Msg) (PipelineModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.jdPasteStage != "" {
			return m.handleJDPaste(msg)
		}
		if m.draftPicker {
			return m.handleDraftPicker(msg)
		}
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		if m.discardPicker {
			return m.handleDiscardPicker(msg)
		}
		if m.editPicker || m.editInput {
			return m.handleEdit(msg)
		}
		if m.searchInput {
			return m.handleSearchInput(msg)
		}
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case PipelineURLCheckedMsg:
		return m.handleURLChecked(msg)
	}
	return m, nil
}

func (m PipelineModel) handleKey(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		// While a search is committed, Esc clears the search (matches vim's `:nohl`
		// ergonomics). With no query, Esc is a no-op — q is the only quit key, which
		// keeps the help bar honest and avoids accidental exits.
		if m.searchQuery != "" {
			m.searchQuery = ""
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.loadCurrentReport()
		}
		return m, nil

	case "q":
		// Background tasks are detached, so quitting never kills work in flight.
		return m, func() tea.Msg { return PipelineClosedMsg{} }
	case "e":
		if _, ok := m.CurrentApp(); ok {
			m.editPicker = true
			m.editCursor = 0
		}
	case "v":
		if pipelineTabs[m.activeTab].filter == filterPending {
			if app, ok := m.CurrentApp(); ok && app.IsPending && app.Number > 0 {
				return m.startWorkflow("evaluate", app.Number)
			}
		}
	case "J":
		if pipelineTabs[m.activeTab].filter == filterPending && !m.jdSubmitting {
			m.jdPasteStage = "url"
			m.jdPasteURL = ""
			m.jdPasteCompany = ""
			m.jdCompanyCursor = 0
			m.jdPasteRole = ""
			m.jdPasteText = ""
			return m, nil
		}
	case "d":
		// Output-folder locks protect concurrent drafts for the same job.
		if pipelineTabs[m.activeTab].filter == filterEvaluated {
			if app, ok := m.CurrentApp(); ok && app.Number > 0 && app.ReportPath != "" {
				m.draftPicker = true
				m.draftCursor = 0
			}
		}
	case "t":
		return m, func() tea.Msg { return PipelineOpenTasksMsg{} }

	case "/":
		// Open search input. Pre-fill with the current query so refining is one keystroke away.
		m.searchInput = true
		return m, nil

	case "down", "j":
		if len(m.filtered) > 0 {
			m.cursor++
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "up", "k":
		if len(m.filtered) > 0 {
			m.cursor--
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "s":
		// Cycle sort mode
		for i, s := range sortCycle {
			if s == m.sortMode {
				m.sortMode = sortCycle[(i+1)%len(sortCycle)]
				break
			}
		}
		if m.sortMode == sortStatus && pipelineTabs[m.activeTab].filter == filterPending {
			m.sortMode = sortAdded
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "f", "right", "l":
		m.activeTab++
		if m.activeTab >= len(pipelineTabs) {
			m.activeTab = 0
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "left", "h":
		m.activeTab--
		if m.activeTab < 0 {
			m.activeTab = len(pipelineTabs) - 1
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "enter":
		if app, ok := m.CurrentApp(); ok {
			if app.IsPending && app.JDPath != "" {
				fullPath := filepath.Join(m.careerOpsPath, app.JDPath)
				title := fmt.Sprintf("JD: %s — %s", app.Company, app.Role)
				jobURL := app.JobURL
				return m, func() tea.Msg {
					return PipelineOpenReportMsg{Path: fullPath, Title: title, JobURL: jobURL, JDJobID: app.Number}
				}
			}
			if !app.IsPending && app.ReportPath != "" {
				fullPath := filepath.Join(m.careerOpsPath, app.ReportPath)
				title := fmt.Sprintf("%s — %s", app.Company, app.Role)
				jobURL := app.JobURL
				cvPath := ""
				if app.CVPath != "" {
					cvPath = filepath.Join(m.careerOpsPath, app.CVPath)
				}
				letterPath := ""
				if app.LetterPath != "" {
					letterPath = filepath.Join(m.careerOpsPath, app.LetterPath)
				}
				briefPath := ""
				if app.BriefPath != "" {
					briefPath = filepath.Join(m.careerOpsPath, app.BriefPath)
				}
				prepPath := ""
				if app.PrepPath != "" {
					prepPath = filepath.Join(m.careerOpsPath, app.PrepPath)
				}
				reportJDJobID := 0
				reportJDPath := ""
				if app.JDPath != "" {
					reportJDJobID = app.Number
					reportJDPath = filepath.Join(m.careerOpsPath, app.JDPath)
				}
				return m, func() tea.Msg {
					return PipelineOpenReportMsg{
						Path:          fullPath,
						Title:         title,
						JobURL:        jobURL,
						ReportJDJobID: reportJDJobID,
						ReportJDPath:  reportJDPath,
						CVPath:        cvPath,
						LetterPath:    letterPath,
						BriefPath:     briefPath,
						PrepPath:      prepPath,
					}
				}
			}
		}

	case "o":
		if app, ok := m.CurrentApp(); ok && app.JobURL != "" {
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: app.JobURL}
			}
		}

	case "p":
		return m, func() tea.Msg { return PipelineOpenProgressMsg{} }

	case "n":
		if pipelineTabs[m.activeTab].filter == filterPending && !m.scanning {
			m.scanning = true
			m.scanStatus = ""
			return m, func() tea.Msg { return PipelineRunScanMsg{} }
		}

	case "r":
		return m, func() tea.Msg { return PipelineRefreshMsg{} }

	case "c":
		if _, ok := m.CurrentApp(); ok {
			m.statusPicker = true
			m.statusCursor = 0
		}

	case "x":
		if _, ok := m.CurrentApp(); ok {
			m.discardPicker = true
			m.discardCursor = 0
		}

	case "g":
		if len(m.filtered) > 0 {
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.loadCurrentReport()
		}

	case "G":
		if len(m.filtered) > 0 {
			m.cursor = len(m.filtered) - 1
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "pgdown", "ctrl+d":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor += halfPage
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "pgup", "ctrl+u":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor -= halfPage
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}
	}

	return m, nil
}

// handleSearchInput consumes keys while the search input bar is open.
// Esc cancels (closes input AND clears query). Enter commits (closes input,
// keeps query, refreshes filtered list). Backspace + printable chars edit
// the query and live-update the filter so the user sees results as they type.
//
// Report previews are NOT lazy-loaded on every keystroke — that would trigger
// a synchronous os.ReadFile per rune/backspace/ctrl+u and stutter live
// typing. Instead the load fires once when the user commits (Enter) or
// cancels (Esc); subsequent cursor movement in handleKey loads as before.
func (m PipelineModel) handleSearchInput(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.searchInput = false
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.loadCurrentReport()

	case "enter":
		m.searchInput = false
		// Query already applied during typing; load the preview for the
		// committed first match (skipped during typing for perf).
		return m, m.loadCurrentReport()

	case "backspace":
		if len(m.searchQuery) > 0 {
			// Drop the last UTF-8 rune so multi-byte characters delete cleanly.
			runes := []rune(m.searchQuery)
			m.searchQuery = string(runes[:len(runes)-1])
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
		}
		return m, nil

	case "ctrl+u":
		// vim-flavored: clear the in-progress query without leaving search mode.
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}

	// Append printable runes (ignore other special keys like arrows / ctrl-combos).
	if r := msg.Runes; len(r) > 0 {
		m.searchQuery += strings.ToLower(string(r))
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleStatusPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		return m, nil

	case "down", "j":
		m.statusCursor++
		if m.statusCursor >= len(statusOptions) {
			m.statusCursor = len(statusOptions) - 1
		}

	case "up", "k":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		if app, ok := m.CurrentApp(); ok {
			newStatus := statusOptions[m.statusCursor]
			return m, func() tea.Msg {
				return PipelineUpdateStatusMsg{
					CareerOpsPath: m.careerOpsPath,
					App:           app,
					NewStatus:     newStatus,
				}
			}
		}
	}
	return m, nil
}

// handleDiscardPicker consumes keys while the discard-reason picker is open.
// Enter fires PipelineDiscardMsg with the selected
// reason; Esc/q cancels without touching database records.
func (m PipelineModel) handleDiscardPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.discardPicker = false
		return m, nil

	case "down", "j":
		m.discardCursor++
		if m.discardCursor >= len(discardReasons) {
			m.discardCursor = len(discardReasons) - 1
		}

	case "up", "k":
		m.discardCursor--
		if m.discardCursor < 0 {
			m.discardCursor = 0
		}

	case "enter":
		m.discardPicker = false
		if app, ok := m.CurrentApp(); ok {
			reason := discardReasons[m.discardCursor]
			return m, func() tea.Msg {
				return PipelineDiscardMsg{
					CareerOpsPath: m.careerOpsPath,
					App:           app,
					Reason:        reason,
				}
			}
		}
	}
	return m, nil
}

var editableFields = []string{"URL", "Role", "Company", "Salary", "JD"}

func (m PipelineModel) handleEdit(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	if m.editInput {
		switch msg.String() {
		case "esc":
			m.editInput, m.editPicker = false, false
		case "enter":
			value := strings.TrimSpace(m.editValue)
			app, ok := m.CurrentApp()
			if !ok || value == "" {
				return m, nil
			}
			if m.editField == "salary_min" {
				m.editField, m.editValue = "salary_max:"+value, ""
				return m, nil
			}
			m.editInput, m.editPicker = false, false
			field, path := m.editField, m.careerOpsPath
			if strings.HasPrefix(field, "salary_max:") {
				field, value = "salary_band", strings.TrimPrefix(field, "salary_max:")+"|"+value
			}
			return m, func() tea.Msg { return PipelineEditJobMsg{CareerOpsPath: path, App: app, Field: field, Value: value} }
		case "backspace":
			r := []rune(m.editValue)
			if len(r) > 0 {
				m.editValue = string(r[:len(r)-1])
			}
		case "ctrl+u":
			m.editValue = ""
		default:
			// Windows terminals can deliver NUL and other control runes with a
			// keypress or paste; PostgreSQL rejects NUL in text columns.
			if msg.Type == tea.KeyRunes {
				m.editValue += strings.Map(func(r rune) rune {
					if unicode.IsPrint(r) {
						return r
					}
					return -1
				}, string(msg.Runes))
			}
		}
		return m, nil
	}
	switch msg.String() {
	case "esc", "q":
		m.editPicker = false
	case "up", "k":
		if m.editCursor > 0 {
			m.editCursor--
		}
	case "down", "j":
		if m.editCursor < len(editableFields)-1 {
			m.editCursor++
		}
	case "enter":
		app, ok := m.CurrentApp()
		if !ok {
			return m, nil
		}
		field := strings.ToLower(editableFields[m.editCursor])
		if field == "jd" {
			m.editPicker = false
			path := m.careerOpsPath
			return m, func() tea.Msg { return PipelineEditJDMsg{CareerOpsPath: path, App: app} }
		}
		if field == "salary" {
			m.editField, m.editValue = "salary_min", ""
		} else {
			m.editField, m.editValue = field, map[string]string{"url": app.JobURL, "role": app.Role, "company": app.Company}[field]
		}
		m.editInput, m.editPicker = true, false
	}
	return m, nil
}

// FinishScan records the outcome of an async src/scan/scan.mjs run started by
// the "S" hotkey on the PENDING tab.
func (m *PipelineModel) FinishScan(output string, err error) {
	m.scanning = false
	m.scanStatus = summarizeScanOutput(output, err)
}

// summarizeScanOutput extracts a one-line status from scan.mjs's combined
// stdout/stderr so the dashboard doesn't have to dump the full log.
func summarizeScanOutput(output string, err error) string {
	if err != nil {
		trimmed := strings.TrimSpace(output)
		if trimmed == "" {
			return "Scan failed: " + err.Error()
		}
		lines := strings.Split(trimmed, "\n")
		return "Scan failed: " + strings.TrimSpace(lines[len(lines)-1])
	}

	newOffers := ""
	errorsLine := ""
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "New offers added:"):
			newOffers = trimmed
		case strings.HasPrefix(trimmed, "Errors ("):
			errorsLine = trimmed
		}
	}
	if newOffers == "" {
		newOffers = "Scan complete"
	}
	if errorsLine != "" {
		return newOffers + " — " + errorsLine
	}
	return newOffers
}

func (m PipelineModel) loadCurrentReport() tea.Cmd {
	app, ok := m.CurrentApp()
	if !ok || app.ReportPath == "" {
		return nil
	}
	if _, cached := m.reportCache[app.ReportPath]; cached {
		return nil
	}
	path := m.careerOpsPath
	report := app.ReportPath
	return func() tea.Msg {
		return PipelineLoadReportMsg{CareerOpsPath: path, ReportPath: report}
	}
}

// matchesSearch reports whether app contains the query as a case-insensitive
// substring of its report number, company, role, notes, or discard reason.
// Empty query matches everything.
// Lowercases both sides so callers don't have to remember the contract.
func matchesSearch(app model.CareerApplication, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	reportNumber := app.ReportNumber
	if reportNumber == "" && app.Number > 0 {
		reportNumber = fmt.Sprint(app.Number)
	}
	if reportNumber != "" && (strings.Contains(strings.ToLower(reportNumber), q) || strings.Contains("#"+strings.ToLower(reportNumber), q)) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Company), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Role), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Notes), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.DiscardReason), q) {
		return true
	}
	return false
}

// applyFilterAndSort rebuilds the filtered list from apps.
func (m *PipelineModel) applyFilterAndSort() {
	var filtered []model.CareerApplication

	currentFilter := pipelineTabs[m.activeTab].filter
	for _, app := range m.apps {
		if !matchesSearch(app, m.searchQuery) {
			continue
		}
		// Pending items only appear in the PENDING tab
		if app.IsPending {
			if currentFilter == filterPending {
				filtered = append(filtered, app)
			}
			continue
		}
		norm := data.NormalizeStatus(app.Status)
		switch currentFilter {
		case filterPending:
			// handled above
		case filterAll:
			filtered = append(filtered, app)
		case filterTop:
			if app.Score >= 4.0 && norm != "discarded" && norm != "ghosted" {
				filtered = append(filtered, app)
			}
		default:
			if norm == currentFilter {
				filtered = append(filtered, app)
			}
		}
	}

	// Sort
	sort.SliceStable(filtered, func(i, j int) bool {
		return m.sortsBefore(filtered[i], filtered[j])
	})

	// In grouped mode, always sort by status priority first, then by selected sort within groups
	if m.viewMode == "grouped" {
		sort.SliceStable(filtered, func(i, j int) bool {
			pi := data.StatusPriority(filtered[i].Status)
			pj := data.StatusPriority(filtered[j].Status)
			if pi != pj {
				return pi < pj
			}
			// Within same group, use selected sort
			return m.sortsBefore(filtered[i], filtered[j])
		})
	}

	// Preserve the active score/date/company order within each partition while
	// bringing evaluated jobs with generated application materials to the top.
	if currentFilter == filterEvaluated {
		sort.SliceStable(filtered, func(i, j int) bool {
			return hasGeneratedApplicationArtifact(filtered[i]) && !hasGeneratedApplicationArtifact(filtered[j])
		})
	}

	m.filtered = filtered
}

// sortsBefore reports whether a precedes b under the active sort mode. Both
// date modes are newest first; each date breaks ties for the other.
func (m PipelineModel) sortsBefore(a, b model.CareerApplication) bool {
	switch m.sortMode {
	case sortStatus:
		ka, kb := lifecycleSortDate(a), lifecycleSortDate(b)
		if ka != kb {
			return ka > kb
		}
		return a.Date > b.Date
	case sortAdded:
		if a.Date != b.Date {
			return a.Date > b.Date
		}
		return lifecycleSortDate(a) > lifecycleSortDate(b)
	case sortCompany:
		return strings.ToLower(a.Company) < strings.ToLower(b.Company)
	default:
		return a.Score > b.Score
	}
}

// sortLabel names the active sort; the status-date mode takes the tab's verb.
func (m PipelineModel) sortLabel() string {
	if m.sortMode != sortStatus {
		return m.sortMode
	}
	switch filter := pipelineTabs[m.activeTab].filter; filter {
	case filterPending:
		return sortAdded
	case filterAll, filterTop:
		return "status date"
	case filterInterview:
		return "interviewed"
	default:
		return filter
	}
}

func lifecycleSortDate(app model.CareerApplication) string {
	if app.IsPending || app.StatusDate == "" || data.NormalizeStatus(app.Status) == "pending" {
		return app.Date
	}
	return app.StatusDate
}

func hasGeneratedApplicationArtifact(app model.CareerApplication) bool {
	return app.CVPath != "" || app.LetterPath != "" || app.BriefPath != ""
}

func generatedArtifactBadge(app model.CareerApplication) string {
	hasCV := app.CVPath != ""
	hasLetter := app.LetterPath != "" || app.BriefPath != ""
	switch {
	case hasCV && hasLetter:
		return "[CV+LETTER]"
	case hasCV:
		return "[CV]"
	case hasLetter:
		return "[LETTER]"
	default:
		return ""
	}
}

// chromeRowsFixed returns the number of fixed chrome rows above/below the body
// (header + tabs(2) + sortbar + help + 1 search bar when active).
// Shared by View() and adjustScroll() so the search-row addition stays in sync.
func (m PipelineModel) chromeRowsFixed() int {
	rows := 6 // header + tabs(2) + sortbar + help + preview baseline
	rows += lipgloss.Height(m.renderHelp()) - 1
	if m.statusBarText() != "" {
		rows++
	}
	if m.searchInput || m.searchQuery != "" {
		rows++
	}
	if m.scanBarVisible() {
		rows++
	}
	return rows
}

// scanBarVisible reports whether the scan status row should render: while a
// scan is running, or after one has left a result to show. The idle hotkey
// hint lives in the bottom hotbar (renderHelp) instead, so this row doesn't
// duplicate it — and it stays visible across tab switches mid-scan.
func (m PipelineModel) scanBarVisible() bool {
	return m.scanning || m.scanStatus != ""
}

// previewBudgetApprox is the approximate row count reserved for the preview block
// when computing scroll positioning. View() measures the actual rendered preview
// height; adjustScroll uses this constant to avoid re-rendering on every keystroke.
const previewBudgetApprox = 5

// adjustScroll updates scrollOffset so the cursor stays visible.
func (m *PipelineModel) adjustScroll() {
	availHeight := m.height - m.chromeRowsFixed() - previewBudgetApprox
	if availHeight < 5 {
		availHeight = 5
	}
	line := m.cursorLineEstimate()
	margin := 3

	if line >= m.scrollOffset+availHeight-margin {
		m.scrollOffset = line - availHeight + margin + 1
	}
	if line < m.scrollOffset+margin {
		m.scrollOffset = line - margin
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m PipelineModel) cursorLineEstimate() int {
	if m.viewMode != "grouped" {
		return m.cursor
	}
	// Account for group headers
	line := 0
	prevStatus := ""
	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)
		if norm != prevStatus {
			line++ // group header
			prevStatus = norm
		}
		if i == m.cursor {
			return line
		}
		line++
	}
	return line
}

// -- View --

// View renders the pipeline screen.
func (m PipelineModel) View() string {
	header := m.renderHeader()
	tabs := m.renderTabs()
	sortBar := m.renderSortBar()
	searchBar := m.renderSearchBar()
	scanBar := m.renderScanBar()
	body := m.renderBody()
	preview := m.renderPreview()
	help := m.renderHelp()

	// Apply scroll to body
	bodyLines := strings.Split(body, "\n")
	if m.scrollOffset > 0 && m.scrollOffset < len(bodyLines) {
		bodyLines = bodyLines[m.scrollOffset:]
	}

	// Calculate available height for body
	previewLines := strings.Count(preview, "\n") + 1
	availHeight := m.height - m.chromeRowsFixed() - previewLines
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}
	body = strings.Join(bodyLines, "\n")

	// Status picker overlay
	if m.statusPicker {
		body = m.overlayStatusPicker(body)
	}
	if m.discardPicker {
		body = m.overlayDiscardPicker(body)
	}
	if m.editPicker {
		body = m.overlayEditPicker(body)
	}
	if m.editInput {
		body = m.overlayEditInput(body)
	}
	if m.draftPicker {
		body = m.renderDraftPicker()
	}
	if m.jdPasteStage != "" {
		body = m.renderJDPaste()
	}

	sections := []string{header, tabs, sortBar}
	if searchBar != "" {
		sections = append(sections, searchBar)
	}
	if scanBar != "" {
		sections = append(sections, scanBar)
	}
	if status := m.statusBarText(); status != "" {
		sections = append(sections, lipgloss.NewStyle().Foreground(m.theme.Yellow).Padding(0, 2).Render(truncateRunes(status, max(1, m.width-4))))
	}
	sections = append(sections, body, preview, help)
	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// renderSearchBar returns an empty string when there is no active or in-progress
// search; otherwise it renders a vim-style status line showing the query and the
// match count. While in input mode, a trailing cursor is appended.
func (m PipelineModel) renderSearchBar() string {
	if !m.searchInput && m.searchQuery == "" {
		return ""
	}

	style := lipgloss.NewStyle().
		Foreground(m.theme.Text).
		Width(m.width).
		Padding(0, 2)

	prompt := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("/")
	queryStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	display := queryStyle.Render(m.searchQuery)
	if m.searchInput {
		display += lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
	}

	tabFiltered := m.countForFilter(pipelineTabs[m.activeTab].filter)
	matchInfo := hintStyle.Render(fmt.Sprintf("  %d/%d matching", len(m.filtered), tabFiltered))

	hint := ""
	if m.searchInput {
		hint = hintStyle.Render("   Enter: keep   Esc: cancel   Ctrl+U: clear")
	} else {
		hint = hintStyle.Render("   Esc: clear   /: edit")
	}

	return style.Render(prompt + " " + display + matchInfo + hint)
}

// renderScanBar renders the scan hotkey/status row shown at the bottom of
// the PENDING tab (and elsewhere while a scan is in flight or has a result
// still worth showing). Empty string means "don't render this row".
func (m PipelineModel) renderScanBar() string {
	if !m.scanBarVisible() {
		return ""
	}

	style := lipgloss.NewStyle().
		Foreground(m.theme.Text).
		Width(m.width).
		Padding(0, 2)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue)

	if m.scanning {
		return style.Render(lipgloss.NewStyle().Foreground(m.theme.Yellow).Render("⏳ Scanning for new postings (node src/scan/scan.mjs)..."))
	}

	statusColor := m.theme.Green
	if strings.HasPrefix(m.scanStatus, "Scan failed") {
		statusColor = m.theme.Red
	}
	statusText := lipgloss.NewStyle().Foreground(statusColor).Render(m.scanStatus)
	return style.Render(statusText + hintStyle.Render("   ") + keyStyle.Render("n") + hintStyle.Render(" scan again"))
}

func (m PipelineModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	avg := fmt.Sprintf("%.1f", m.metrics.AvgScore)
	info := right.Render(fmt.Sprintf("%d offers | Avg %s/5", m.metrics.Total, avg))

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("CAREER PIPELINE")
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(info) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + info)
}

func (m PipelineModel) renderTabs() string {
	var tabs []string
	var underParts []string

	for i, tab := range pipelineTabs {
		// Count items for this tab
		count := m.countForFilter(tab.filter)
		label := fmt.Sprintf(" %s (%d) ", tab.label, count)

		if i == m.activeTab {
			style := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Blue).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("━", lipgloss.Width(label)))
		} else {
			style := lipgloss.NewStyle().
				Foreground(m.theme.Subtext).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("─", lipgloss.Width(label)))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
	underline := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(strings.Join(underParts, ""))

	padStyle := lipgloss.NewStyle().Padding(0, 1)
	return padStyle.Render(row) + "\n" + padStyle.Render(underline)
}

func (m PipelineModel) countForFilter(filter string) int {
	count := 0
	for _, app := range m.apps {
		if app.IsPending {
			if filter == filterPending {
				count++
			}
			continue
		}
		norm := data.NormalizeStatus(app.Status)
		switch filter {
		case filterPending:
			// handled above
		case filterAll:
			count++
		case filterTop:
			if app.Score >= 4.0 && norm != "discarded" && norm != "ghosted" {
				count++
			}
		default:
			if norm == filter {
				count++
			}
		}
	}
	return count
}

func (m PipelineModel) renderSortBar() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Width(m.width).
		Padding(0, 2)

	sortLabel := fmt.Sprintf("[Sort: %s]", m.sortLabel())
	viewLabel := fmt.Sprintf("[View: %s]", m.viewMode)
	count := fmt.Sprintf("%d shown", len(m.filtered))

	return style.Render(fmt.Sprintf("%s  %s  %s", sortLabel, viewLabel, count))
}

func (m PipelineModel) renderBody() string {
	if len(m.filtered) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		return emptyStyle.Render("No offers match this filter")
	}

	var lines []string
	prevStatus := ""
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)

		// Group header in grouped mode
		if m.viewMode == "grouped" && norm != prevStatus {
			count := m.countByNormStatus(norm)
			headerStyle := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Subtext)
			lines = append(lines, padStyle.Render(
				headerStyle.Render(fmt.Sprintf("── %s (%d) %s",
					strings.ToUpper(statusLabel(norm)), count,
					strings.Repeat("─", max(0, m.width-30-len(statusLabel(norm)))))),
			))
			prevStatus = norm
		}

		selected := i == m.cursor
		line := m.renderAppLine(app, selected)
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

func (m PipelineModel) renderAppLine(app model.CareerApplication, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	// Column widths
	numW := 5   // "#123 "
	scoreW := 5 // "4.5  "
	timeline := lifecycleDates(app)
	timelineW := len([]rune(timeline))
	norm := data.NormalizeStatus(app.Status)
	artifactBadge := ""
	artifactW := 0
	if norm == "evaluated" {
		artifactBadge = generatedArtifactBadge(app)
		artifactW = len([]rune("[CV+LETTER]"))
	}
	discardReasonW := 0
	showDiscardReason := norm == "discarded" && m.width >= 105
	if showDiscardReason {
		discardReasonW = 20
	}
	companyW := 16
	minRoleW := 15
	if m.width < 100 {
		companyW = 11
		minRoleW = 8
	}
	// Lifecycle dates and compensation are fixed columns. Roles use the
	// remaining space and are intentionally truncated when unusually long.
	fixedW := numW + scoreW + companyW + timelineW + artifactW + discardReasonW + 10
	roleW := m.width - fixedW
	// Compensation is a fixed column for every row. Missing data is rendered
	// explicitly below; an empty compensation cell is never valid UI state.
	compW := 40
	roleW -= compW
	if roleW < minRoleW {
		roleW = minRoleW
	}

	numStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true).Width(numW)

	if app.IsPending {
		// Pending items: permanent pipeline ID and no score/comp yet.
		pendingNum := "#—"
		if app.Number > 0 {
			pendingNum = fmt.Sprintf("#%d", app.Number)
		}

		cols := []string{
			numStyle.Render(pendingNum),
			lipgloss.NewStyle().Width(scoreW).Render("—"),
			lipgloss.NewStyle().Foreground(m.theme.Text).Width(companyW).Render(truncateRunes(app.Company, companyW)),
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(roleW).Render(truncateRunes(app.Role, roleW)),
			lipgloss.NewStyle().Foreground(m.theme.Yellow).Width(timelineW).Render(timeline),
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(compW).Render("Not evaluated"),
		}
		line := " " + strings.Join(cols, " ")
		if selected {
			return padStyle.Render(lipgloss.NewStyle().Background(m.theme.Overlay).Width(m.width - 4).Render(line))
		}
		return padStyle.Render(line)
	}

	// Tracker number (fixed width)
	numText := "#—"
	if app.Number > 0 {
		numText = fmt.Sprintf("#%d", app.Number)
	}

	// Score with color
	scoreStyle := m.scoreStyle(app.Score)
	score := scoreStyle.Render(fmt.Sprintf("%.1f", app.Score))

	// Company (truncate)
	company := truncateRunes(app.Company, companyW)
	companyStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(companyW)

	// Role (truncate)
	role := truncateRunes(app.Role, roleW)
	roleStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(roleW)

	// Comp -- fixed column. A manual edit (salary_min/salary_max set through
	// the "e" picker) always wins over the evaluation report's figure.
	comp := "ERROR: compensation estimate missing"
	compColor := m.theme.Red
	if summary, ok := m.reportCache[app.ReportPath]; ok && summary.comp != "" {
		comp = summary.comp
		compColor = m.theme.Yellow
	}
	if edited := editedCompensation(app); edited != "" {
		comp = edited
		compColor = m.theme.Green
	}
	compText := lipgloss.NewStyle().Foreground(compColor).Width(compW).Render(truncateRunes(comp, compW-1))

	cols := []string{
		numStyle.Render(truncateRunes(numText, numW)),
		score,
		companyStyle.Render(company),
		roleStyle.Render(role),
	}
	if artifactW > 0 {
		cols = append(cols, lipgloss.NewStyle().Bold(true).Foreground(m.theme.Green).Width(artifactW).Render(artifactBadge))
	}
	cols = append(cols, lipgloss.NewStyle().Foreground(m.statusColorMap()[norm]).Width(timelineW).Render(timeline))
	if showDiscardReason {
		reason := app.DiscardReason
		if reason == "" {
			reason = "Reason not recorded"
		}
		reasonStyle := lipgloss.NewStyle().Foreground(m.theme.Red).Width(discardReasonW)
		cols = append(cols, reasonStyle.Render(truncateRunes("— "+reason, discardReasonW)))
	}
	cols = append(cols, compText)
	line := " " + strings.Join(cols, " ")

	if selected {
		selStyle := lipgloss.NewStyle().
			Background(m.theme.Overlay).
			Width(m.width - 4)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

func lifecycleDates(app model.CareerApplication) string {
	added := app.Date
	if added == "" {
		added = "unknown"
	}
	norm := data.NormalizeStatus(app.Status)
	if norm == "pending" {
		return "added " + added
	}
	statusDate := app.StatusDate
	if statusDate == "" {
		statusDate = "unknown"
	}
	verb := map[string]string{
		"evaluated": "evaluated",
		"applied":   "applied",
		"interview": "interviewed",
		"offer":     "offered",
		"ghosted":   "ghosted",
		"rejected":  "rejected",
		"discarded": "discarded",
	}[norm]
	if verb == "" {
		verb = norm
	}
	return fmt.Sprintf("%s %s, added %s", verb, statusDate, added)
}

func (m PipelineModel) renderPreview() string {
	app, ok := m.CurrentApp()
	if !ok {
		return ""
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	divider := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	var lines []string
	lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("─", m.width-4))))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	// Pending items get a simple URL preview
	if app.IsPending {
		if app.JobURL != "" {
			lines = append(lines, padStyle.Render(labelStyle.Render("URL: ")+valueStyle.Render(truncateRunes(app.JobURL, m.width-16))))
		}
		if app.JDPath == "" {
			lines = append(lines, padStyle.Render(dimStyle.Render("No cached JD — press o to open URL · x to discard (no eval)")))
		} else {
			lines = append(lines, padStyle.Render(dimStyle.Render("Press Enter to read JD · o to open URL · x to discard (no eval)")))
		}
		return strings.Join(lines, "\n")
	}

	// Check report cache
	if summary, ok := m.reportCache[app.ReportPath]; ok {
		if summary.archetype != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Archetype: ")+valueStyle.Render(summary.archetype)))
		}
		if summary.tldr != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("TL;DR: ")+valueStyle.Render(summary.tldr)))
		}
		if edited := editedCompensation(app); edited != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Comp: ")+valueStyle.Render(edited)))
		} else if summary.comp != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Comp: ")+valueStyle.Render(summary.comp)))
		}
		if summary.remote != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Remote: ")+valueStyle.Render(summary.remote)))
		}
	} else if edited := editedCompensation(app); edited != "" {
		lines = append(lines, padStyle.Render(
			labelStyle.Render("Comp: ")+valueStyle.Render(edited)))
	} else if app.Notes != "" {
		// Fallback: show notes
		notes := truncateRunes(app.Notes, m.width-10)
		lines = append(lines, padStyle.Render(dimStyle.Render(notes)))
	} else {
		lines = append(lines, padStyle.Render(dimStyle.Render("Loading preview...")))
	}

	return strings.Join(lines, "\n")
}

func (m PipelineModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	if m.draftPicker {
		return style.Render("↑↓/jk select   Enter generate   Esc cancel")
	}

	if m.jdPasteStage == "url" || m.jdPasteStage == "role" {
		return style.Render(
			keyStyle.Render("Enter") + descStyle.Render(" continue  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}
	if m.jdPasteStage == "blocked" {
		return style.Render(
			keyStyle.Render("any key") + descStyle.Render(" back to URL  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}
	if m.jdPasteStage == "confirm" {
		return style.Render(
			keyStyle.Render("y") + descStyle.Render(" continue anyway  ") +
				keyStyle.Render("n") + descStyle.Render(" cancel"))
	}
	if m.jdPasteStage == "text" {
		return style.Render(
			keyStyle.Render("paste/type") + descStyle.Render(" fill  ") +
				keyStyle.Render("Ctrl+S") + descStyle.Render(" submit  ") +
				keyStyle.Render("Ctrl+U") + descStyle.Render(" clear  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	if m.statusPicker {
		return style.Render(
			keyStyle.Render("↑↓/jk") + descStyle.Render(" navigate  ") +
				keyStyle.Render("Enter") + descStyle.Render(" confirm  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	if m.discardPicker {
		return style.Render(
			keyStyle.Render("↑↓/jk") + descStyle.Render(" navigate  ") +
				keyStyle.Render("Enter") + descStyle.Render(" confirm discard  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}
	if m.editPicker || m.editInput {
		return style.Render(keyStyle.Render("↑↓/jk") + descStyle.Render(" navigate  ") + keyStyle.Render("Enter") + descStyle.Render(" confirm  ") + keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	if m.searchInput {
		return style.Render(
			keyStyle.Render("type") + descStyle.Render(" filter live  ") +
				keyStyle.Render("Enter") + descStyle.Render(" keep  ") +
				keyStyle.Render("Ctrl+U") + descStyle.Render(" clear  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("career-ops")

	keys := keyStyle.Render("↑↓/jk") + descStyle.Render(" nav  ") +
		keyStyle.Render("←→/hl") + descStyle.Render(" tabs  ") +
		keyStyle.Render("/") + descStyle.Render(" search  ") +
		keyStyle.Render("s") + descStyle.Render(" sort  ") +
		keyStyle.Render("r") + descStyle.Render(" refresh  ") +
		keyStyle.Render("Enter") + descStyle.Render(" report  ") +
		keyStyle.Render("o") + descStyle.Render(" open URL  ") +
		keyStyle.Render("c") + descStyle.Render(" change status  ") +
		keyStyle.Render("x") + descStyle.Render(" discard  ") +
		keyStyle.Render("e") + descStyle.Render(" edit  ") +
		keyStyle.Render("p") + descStyle.Render(" progress  ")

	if pipelineTabs[m.activeTab].filter == filterPending {
		keys += keyStyle.Render("n") + descStyle.Render(" scan  ")
		keys += keyStyle.Render("v") + descStyle.Render(" evaluate  ")
		keys += keyStyle.Render("J") + descStyle.Render(" paste JD  ")
	}
	if pipelineTabs[m.activeTab].filter == filterEvaluated {
		keys += keyStyle.Render("d") + descStyle.Render(" generate  ")
	}
	if m.workflowLog != "" {
		keys += keyStyle.Render("t") + descStyle.Render(" task log  ")
	}

	keys += keyStyle.Render("q") + descStyle.Render(" quit")

	gap := m.width - lipgloss.Width(keys) - lipgloss.Width(brand) - 2
	if gap < 1 {
		gap = 1
	}

	return style.Render(keys + strings.Repeat(" ", gap) + brand)
}

func (m PipelineModel) overlayEditPicker(body string) string {
	lines := []string{"Edit selected job", ""}
	for i, field := range editableFields {
		marker := "  "
		if i == m.editCursor {
			marker = ">>"
		}
		lines = append(lines, marker+" "+field)
	}
	return body + "\n\n" + lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1, 3).Render(strings.Join(lines, "\n"))
}

func (m PipelineModel) overlayEditInput(body string) string {
	label := m.editField
	if label != "" {
		label = strings.ToUpper(label[:1]) + label[1:]
	}
	return body + "\n\n" + lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1, 3).Render(label+": "+m.editValue+"█")
}

func (m PipelineModel) overlayStatusPicker(body string) string {
	// Render status picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Change status:")))

	for i, opt := range statusOptions {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = "> "
		}
		picker = append(picker, padStyle.Render(style.Render(prefix+opt)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

func (m PipelineModel) overlayDiscardPicker(body string) string {
	// Render discard-reason picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 46
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Red).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Discard — reason:")))

	for i, opt := range discardReasons {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.discardCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.discardCursor {
			prefix = "> "
		}
		picker = append(picker, padStyle.Render(style.Render(prefix+opt)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// -- Helpers --

func (m PipelineModel) scoreStyle(score float64) lipgloss.Style {
	switch {
	case score >= 4.2:
		return lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	case score >= 3.8:
		return lipgloss.NewStyle().Foreground(m.theme.Yellow)
	case score >= 3.0:
		return lipgloss.NewStyle().Foreground(m.theme.Text)
	default:
		return lipgloss.NewStyle().Foreground(m.theme.Red)
	}
}

func (m PipelineModel) statusColorMap() map[string]lipgloss.Color {
	return map[string]lipgloss.Color{
		"interview": m.theme.Green,
		"offer":     m.theme.Green,
		"applied":   m.theme.Sky,
		"evaluated": m.theme.Text,
		"pending":   m.theme.Yellow,
		"ghosted":   m.theme.Yellow,
		"rejected":  m.theme.Subtext,
		"discarded": m.theme.Subtext,
	}
}

func (m PipelineModel) countByNormStatus(status string) int {
	count := 0
	for _, app := range m.filtered {
		if data.NormalizeStatus(app.Status) == status {
			count++
		}
	}
	return count
}

// truncateRunes truncates a string to at most maxRunes runes, appending "..." if truncated.
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	if maxRunes <= 3 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-3]) + "..."
}

// editedCompensation formats a manually edited salary_min/salary_max pair
// (set through the dashboard's "e" edit picker) so the pipeline table and
// detail view show the correction instead of the stale evaluation-report
// figure. Editing only ever touches the two DB columns, never the archived
// report file, so this stays the single place that renders them.
func editedCompensation(app model.CareerApplication) string {
	if app.SalaryMin == nil || app.SalaryMax == nil {
		return ""
	}
	return fmt.Sprintf("%s - %s (edited)", formatMoney(*app.SalaryMin), formatMoney(*app.SalaryMax))
}

// formatMoney renders a non-negative amount as "$1,234,567" (no cents).
func formatMoney(amount float64) string {
	n := int64(amount + 0.5)
	digits := fmt.Sprintf("%d", n)
	var out []byte
	for i, c := range []byte(digits) {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	return "$" + string(out)
}

func statusLabel(norm string) string {
	switch norm {
	case "interview":
		return "Interview"
	case "offer":
		return "Offer"
	case "applied":
		return "Applied"
	case "evaluated":
		return "Evaluated"
	case "pending":
		return "Pending"
	case "ghosted":
		return "Ghosted"
	case "rejected":
		return "Rejected"
	case "discarded":
		return "Discarded"
	default:
		return norm
	}
}
