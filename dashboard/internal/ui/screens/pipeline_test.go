package screens

import (
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"career-ops/dashboard/internal/model"
	"career-ops/dashboard/internal/theme"
)

func TestJDPasteIgnoresModifierRunes(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, t.TempDir(), 120, 40)
	pm.jdPasteStage = "text"
	for i := 0; i < 20; i++ {
		pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{0}})
		pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyCtrlV})
	}
	if pm.jdPasteText != "" {
		t.Fatalf("modifiers inserted %q", pm.jdPasteText)
	}
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("Café\r\nEngineer\tPython"), Paste: true})
	if pm.jdPasteText != "Café\nEngineer\tPython" {
		t.Fatalf("paste corrupted: %q", pm.jdPasteText)
	}
}

func TestJDPasteSurvivesDatabaseRefresh(t *testing.T) {
	for _, stage := range []string{"url", "company", "role", "text"} {
		t.Run(stage, func(t *testing.T) {
			pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, t.TempDir(), 120, 40)
			pm.jdPasteStage = stage
			pm.jdPasteURL = "https://example.com/job"
			pm.jdPasteCompany = "Example Inc."
			pm.jdPasteRole = "ML Engineer"
			pm.jdPasteText = "First line\nCafé engineer"
			for i := 0; i < 3; i++ {
				pm = pm.WithReloadedData(nil, model.PipelineMetrics{})
				if pm.jdPasteStage != stage || pm.jdPasteURL != "https://example.com/job" || pm.jdPasteText != "First line\nCafé engineer" {
					t.Fatal("refresh discarded paste editor state")
				}
			}
			if stage == "url" {
				var cmd tea.Cmd
				pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
				if cmd == nil {
					t.Fatal("Enter at the URL step did not trigger a PostgreSQL check")
				}
				checkMsg, ok := cmd().(PipelineCheckURLMsg)
				if !ok || checkMsg.URL != "https://example.com/job" {
					t.Fatalf("expected a URL check, got %+v", cmd())
				}
				pm, _ = pm.Update(PipelineURLCheckedMsg{URL: checkMsg.URL})
			}
			if pm.jdPasteStage == "company" {
				pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
			}
			if pm.jdPasteStage == "role" {
				pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
			}
			pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyCtrlS})
			if cmd == nil {
				t.Fatal("editor cannot submit after refresh")
			}
			msg, ok := cmd().(PipelineSubmitJDMsg)
			if !ok || msg.URL != "https://example.com/job" || msg.Role != "ML Engineer" || msg.Text != "First line\nCafé engineer" {
				t.Fatalf("incorrect submission: %+v", msg)
			}
			if pm.jdPasteStage != "" || !pm.jdSubmitting {
				t.Fatal("submission state incorrect")
			}
		})
	}
}

func TestEnterPassesSelectedRoleArtifactsToViewer(t *testing.T) {
	app := model.CareerApplication{
		Number:     979,
		Company:    "LCBO",
		Role:       "Senior Manager, Cybersecurity Operations",
		Status:     "Evaluated",
		Score:      2.4,
		ReportPath: filepath.Join("reports", "979-lcbo-2026-09-10.md"),
		JDPath:     filepath.Join("data", "jds", "979-lcbo.md"),
		JobURL:     "https://example.com/lcbo/apply",
		CVPath:     filepath.Join("output", "lcbo", "senior-manager-cybersecurity-operations", "cv-user.html"),
		LetterPath: filepath.Join("output", "lcbo", "senior-manager-cybersecurity-operations", "cover-letter.html"),
		BriefPath:  filepath.Join("output", "lcbo", "senior-manager-cybersecurity-operations", "cover-letter-brief.md"),
	}
	root := filepath.Join("C:", "career-ops")
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), []model.CareerApplication{app}, model.PipelineMetrics{Total: 1}, root, 120, 40)

	_, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("Enter returned no command")
	}
	msg, ok := cmd().(PipelineOpenReportMsg)
	if !ok {
		t.Fatalf("Enter emitted %T, want PipelineOpenReportMsg", cmd())
	}
	if msg.JobURL != app.JobURL {
		t.Errorf("JobURL = %q, want %q", msg.JobURL, app.JobURL)
	}
	if msg.ReportJDJobID != app.Number || msg.ReportJDPath != filepath.Join(root, app.JDPath) {
		t.Errorf("report JD = (%d, %q), want selected role JD", msg.ReportJDJobID, msg.ReportJDPath)
	}
	if msg.CVPath != filepath.Join(root, app.CVPath) {
		t.Errorf("CVPath = %q, want selected role path", msg.CVPath)
	}
	if msg.LetterPath != filepath.Join(root, app.LetterPath) {
		t.Errorf("LetterPath = %q, want selected role path", msg.LetterPath)
	}
	if msg.BriefPath != filepath.Join(root, app.BriefPath) {
		t.Errorf("BriefPath = %q, want selected role path", msg.BriefPath)
	}
}

func tabIndexForFilter(t *testing.T, filter string) int {
	t.Helper()

	for i, tab := range pipelineTabs {
		if tab.filter == filter {
			return i
		}
	}

	t.Fatalf("expected pipeline tabs to include filter %q", filter)
	return -1
}

func TestWithReloadedDataPreservesStateAndSelection(t *testing.T) {
	initialApps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Evaluated",
			Score:      4.2,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/002-beta.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		initialApps,
		model.PipelineMetrics{Total: len(initialApps)},
		"..",
		120,
		40,
	)
	pm.sortMode = sortCompany
	pm.activeTab = 0
	pm.viewMode = "flat"
	pm.applyFilterAndSort()
	pm.cursor = 1
	pm.reportCache["reports/002-beta.md"] = reportSummary{tldr: "cached"}

	refreshedApps := []model.CareerApplication{
		initialApps[0],
		initialApps[1],
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Interview",
			Score:      4.8,
			ReportPath: "reports/003-gamma.md",
		},
	}

	reloaded := pm.WithReloadedData(refreshedApps, model.PipelineMetrics{Total: len(refreshedApps)})

	if reloaded.sortMode != sortCompany {
		t.Fatalf("expected sort mode %q, got %q", sortCompany, reloaded.sortMode)
	}
	if reloaded.viewMode != "flat" {
		t.Fatalf("expected view mode to stay flat, got %q", reloaded.viewMode)
	}
	if got := len(reloaded.filtered); got != 3 {
		t.Fatalf("expected 3 filtered apps after refresh, got %d", got)
	}
	if app, ok := reloaded.CurrentApp(); !ok || app.ReportPath != "reports/002-beta.md" {
		t.Fatalf("expected selection to stay on beta app, got %+v (ok=%v)", app, ok)
	}
	if reloaded.reportCache["reports/002-beta.md"].tldr != "cached" {
		t.Fatal("expected cached report summaries to survive refresh")
	}
}

func TestRenderAppLineShowsLabeledLifecycleDatesAfterRole(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		120,
		40,
	)

	line := pm.renderAppLine(model.CareerApplication{
		Number:     42,
		Date:       "2026-04-13",
		StatusDate: "2026-04-20",
		Company:    "Anthropic",
		Role:       "Forward Deployed Engineer",
		Status:     "Applied",
		Score:      4.5,
	}, false)

	if !strings.Contains(line, "applied 2026-04-20, added 2026-04-13") {
		t.Fatalf("expected rendered line to label both dates, got %q", line)
	}
	if strings.Index(line, "Forward Deployed Engineer") > strings.Index(line, "applied 2026-04-20") {
		t.Fatalf("expected lifecycle dates after role, got %q", line)
	}
	if !strings.Contains(line, "#42") {
		t.Fatalf("expected rendered line to include tracker number marker, got %q", line)
	}
	pm.viewMode = "flat"
	line = pm.renderAppLine(model.CareerApplication{Number: 42, Company: "Anthropic", Role: "Engineer", Status: "Applied", StatusDate: "2026-04-20"}, false)
	if !strings.Contains(line, "applied 2026-04-20") {
		t.Fatalf("expected flat view lifecycle text to identify status, got %q", line)
	}
}

func TestLifecycleDateLabelsCoverEveryPage(t *testing.T) {
	cases := map[string]string{
		"Evaluated": "evaluated",
		"Applied":   "applied",
		"Interview": "interviewed",
		"Offer":     "offered",
		"Ghosted":   "ghosted",
		"Rejected":  "rejected",
		"Discarded": "discarded",
	}
	for status, verb := range cases {
		app := model.CareerApplication{Status: status, StatusDate: "2026-04-20", Date: "2026-04-13"}
		if got := lifecycleDates(app); got != verb+" 2026-04-20, added 2026-04-13" {
			t.Fatalf("%s lifecycle label = %q", status, got)
		}
	}
	if got := lifecycleDates(model.CareerApplication{Status: "Pending", Date: "2026-04-13"}); got != "added 2026-04-13" {
		t.Fatalf("pending lifecycle label = %q", got)
	}
	if got := lifecycleDates(model.CareerApplication{Status: "Rejected"}); got != "rejected unknown, added unknown" {
		t.Fatalf("unknown lifecycle dates should be explicit, got %q", got)
	}
}

func TestViewOmitsDuplicateStatusTotalsRow(t *testing.T) {
	apps := []model.CareerApplication{{Number: 42, Company: "Acme", Role: "Engineer", Status: "Interview", Score: 4.5}}
	metrics := model.PipelineMetrics{Total: 1, ByStatus: map[string]int{"interview": 1}}
	view := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, metrics, "..", 140, 40).View()
	if strings.Contains(view, "Interview:1") {
		t.Fatalf("duplicate status totals row still rendered: %q", view)
	}
}

func TestDiscardReasonIsRenderedBesideRole(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 180, 40)
	line := pm.renderAppLine(model.CareerApplication{
		Number:        42,
		Company:       "Acme",
		Role:          "Staff Engineer",
		Status:        "Discarded",
		DiscardReason: "Seniority mismatch",
	}, false)

	if !strings.Contains(line, "Staff Engineer") || !strings.Contains(line, "Seniority mismatch") {
		t.Fatalf("expected discard reason beside role, got %q", line)
	}
}

func TestStatusAndDiscardUseSeparateHotkeys(t *testing.T) {
	app := model.CareerApplication{Number: 42, Company: "Acme", Role: "Engineer", Status: "Evaluated"}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), []model.CareerApplication{app}, model.PipelineMetrics{}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterAll)
	pm.applyFilterAndSort()

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
	if !pm.statusPicker || pm.discardPicker {
		t.Fatal("c should open only the status picker")
	}
	if got := strings.Join(statusOptions, ","); got != "Applied,Rejected,Interview,Offer,Pending,Evaluated" {
		t.Fatalf("unexpected status options/order: %s", got)
	}
	pm.statusCursor = 4
	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("status confirmation returned no command")
	}
	statusMsg, ok := cmd().(PipelineUpdateStatusMsg)
	if !ok || statusMsg.NewStatus != "Pending" || statusMsg.App.Number != 42 {
		t.Fatalf("unexpected move-to-pending message: %#v", statusMsg)
	}
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	if !pm.discardPicker || pm.statusPicker {
		t.Fatal("x should open only the discard picker")
	}
	if got := strings.Join(discardReasons, ","); got != "Expired,Seniority mismatch,Wrong role,Wrong location,Duplicate,Other" {
		t.Fatalf("unexpected discard reasons/order: %s", got)
	}
	_, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("discard confirmation returned no command")
	}
	msg, ok := cmd().(PipelineDiscardMsg)
	if !ok || msg.Reason != "Expired" {
		t.Fatalf("unexpected discard message: %#v", msg)
	}
}

func TestRenderAppLineShowsFullCompBand(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 200, 40)
	comp := "$81,600 - $115,200 CAD (base pay)"
	pm.reportCache["reports/42.md"] = reportSummary{comp: comp}
	line := pm.renderAppLine(model.CareerApplication{Number: 42, Company: "Acme", Role: "Engineer", Status: "Applied", ReportPath: "reports/42.md"}, false)
	if !strings.Contains(line, comp) {
		t.Fatalf("expected comp band %q untruncated at width 200, got %q", comp, line)
	}
}

func TestRenderAppLinePrefersEditedCompensationOverReport(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 200, 40)
	pm.reportCache["reports/42.md"] = reportSummary{comp: "$81,600 - $115,200 CAD (base pay)"}
	min, max := 90000.0, 110000.0
	line := pm.renderAppLine(model.CareerApplication{
		Number: 42, Company: "Acme", Role: "Engineer", Status: "Applied", ReportPath: "reports/42.md",
		SalaryMin: &min, SalaryMax: &max,
	}, false)
	if !strings.Contains(line, "$90,000 - $110,000 (edited)") {
		t.Fatalf("expected edited compensation to override the report figure, got %q", line)
	}
	if strings.Contains(line, "$81,600") {
		t.Fatalf("stale report compensation must not still appear once edited, got %q", line)
	}
}

func TestRenderPreviewPrefersEditedCompensationOverReport(t *testing.T) {
	min, max := 90000.0, 110000.0
	apps := []model.CareerApplication{{
		Number: 42, Company: "Acme", Role: "Engineer", Status: "Applied", ReportPath: "reports/42.md",
		SalaryMin: &min, SalaryMax: &max,
	}}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: 1}, "..", 200, 40)
	pm.applyFilterAndSort()
	pm.cursor = 0
	pm.reportCache["reports/42.md"] = reportSummary{comp: "$81,600 - $115,200 CAD (base pay)", tldr: "cached"}

	preview := pm.renderPreview()
	if !strings.Contains(preview, "$90,000 - $110,000 (edited)") {
		t.Fatalf("expected preview to show edited compensation, got %q", preview)
	}
	if strings.Contains(preview, "$81,600") {
		t.Fatalf("stale report compensation must not still appear once edited, got %q", preview)
	}
}

func TestRenderAppLineNeverLeavesCompensationBlank(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 200, 40)
	line := pm.renderAppLine(model.CareerApplication{Number: 44, Company: "Acme", Role: "Engineer", Status: "Evaluated", ReportPath: "reports/44.md"}, false)
	if !strings.Contains(line, "ERROR: compensation estimate missing") {
		t.Fatalf("missing compensation must be visible as a contract error, got %q", line)
	}
}

func TestRenderAppLineKeepsCompensationVisibleAndTruncatesLongRole(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 200, 40)
	comp := "$100,000 - $120,000 CAD"
	pm.reportCache["reports/43.md"] = reportSummary{comp: comp}
	line := pm.renderAppLine(model.CareerApplication{
		Number: 43, Company: "Acme", Role: "An exceptionally long role title that should be truncated in the dashboard when it exceeds the fixed role column width", Status: "Applied", ReportPath: "reports/43.md",
	}, false)
	if !strings.Contains(line, "...") || !strings.Contains(line, comp) {
		t.Fatalf("expected long role truncation and persistent compensation, got %q", line)
	}
}

func TestEvaluatedArtifactsSortFirstAndRenderBadges(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1, Company: "No Artifact", Role: "Engineer", Status: "Evaluated", Score: 5.0},
		{Number: 2, Company: "CV", Role: "Engineer", Status: "Evaluated", Score: 3.0, CVPath: "output/2/cv.html"},
		{Number: 3, Company: "Letter", Role: "Engineer", Status: "Evaluated", Score: 4.0, LetterPath: "output/3/cover-letter.md"},
		{Number: 4, Company: "Both", Role: "Engineer", Status: "Evaluated", Score: 2.0, CVPath: "output/4/cv.html", BriefPath: "output/4/cover-letter-brief.md"},
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 180, 40)
	pm.activeTab = tabIndexForFilter(t, filterEvaluated)
	pm.applyFilterAndSort()

	got := []int{pm.filtered[0].Number, pm.filtered[1].Number, pm.filtered[2].Number, pm.filtered[3].Number}
	want := []int{3, 2, 4, 1}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("evaluated artifact priority = %v, want %v", got, want)
		}
	}
	for _, tc := range []struct {
		app   model.CareerApplication
		badge string
	}{{apps[1], "[CV]"}, {apps[2], "[LETTER]"}, {apps[3], "[CV+LETTER]"}} {
		if line := pm.renderAppLine(tc.app, false); !strings.Contains(line, tc.badge) {
			t.Fatalf("expected badge %q in %q", tc.badge, line)
		}
	}
}

func TestStatusAndAddedDateSorts(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1, Company: "A", Role: "R", Status: "Evaluated", Date: "2026-09-23", StatusDate: "2026-09-22"},
		{Number: 2, Company: "B", Role: "R", Status: "Evaluated", Date: "2026-09-20", StatusDate: "2026-09-24"},
		{Number: 3, Company: "C", Role: "R", Status: "Evaluated", Date: "2026-09-25", StatusDate: "2026-09-21"},
		{Number: 4, Company: "D", Role: "R", Status: "Evaluated", Date: "2026-09-16", StatusDate: "2026-09-25"},
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 180, 40)
	pm.activeTab = tabIndexForFilter(t, filterEvaluated)
	for _, tc := range []struct {
		mode  string
		label string
		want  []int
	}{{sortStatus, "evaluated", []int{4, 2, 1, 3}}, {sortAdded, "added", []int{3, 1, 2, 4}}} {
		pm.sortMode = tc.mode
		if got := pm.sortLabel(); got != tc.label {
			t.Fatalf("sort label = %q, want %q", got, tc.label)
		}
		for _, view := range []string{"flat", "grouped"} {
			pm.viewMode = view
			pm.applyFilterAndSort()
			for i, n := range tc.want {
				if pm.filtered[i].Number != n {
					t.Fatalf("%s %s sort: position %d = #%d, want order %v", view, tc.mode, i, pm.filtered[i].Number, tc.want)
				}
			}
		}
	}
}

func TestSortCycleSkipsStatusDateOnPending(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 180, 40)
	pm.activeTab = tabIndexForFilter(t, filterPending)
	pm.sortMode = sortScore
	pm, _ = pm.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("s")})
	if pm.sortMode != sortAdded {
		t.Fatalf("pending sort after score = %q, want %q", pm.sortMode, sortAdded)
	}
}

func TestSearchFiltersByCompanyRoleNotesAndReportNumber(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1016, ReportNumber: "1016", Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6, Notes: "payments infra"},
		{Number: 1017, ReportNumber: "1017", Company: "Anthropic", Role: "AI Safety Engineer", Status: "Applied", Score: 4.8, Notes: "policy work"},
		{Number: 1018, ReportNumber: "1018", Company: "Acme Corp", Role: "Senior PM, Voice AI", Status: "Evaluated", Score: 4.2, Notes: "Series B in Madrid"},
		{Number: 1019, ReportNumber: "1019", Company: "Globex", Role: "Platform Engineer", Status: "Applied", Score: 3.9, Notes: "remote-first"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterAll)

	// Match by company substring (case-insensitive).
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Stripe" {
		t.Fatalf("expected 1 match for 'stripe', got %+v", pm.filtered)
	}

	// Match by role substring.
	pm.searchQuery = "voice ai"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Acme Corp" {
		t.Fatalf("expected 1 match for 'voice ai', got %+v", pm.filtered)
	}

	// Match by notes substring.
	pm.searchQuery = "madrid"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Acme Corp" {
		t.Fatalf("expected 1 match for notes 'madrid', got %+v", pm.filtered)
	}

	// Match by permanent report number, with or without its displayed # prefix.
	for _, query := range []string{"1017", "#1017"} {
		pm.searchQuery = query
		pm.applyFilterAndSort()
		if len(pm.filtered) != 1 || pm.filtered[0].Number != 1017 {
			t.Fatalf("expected report-number match for %q, got %+v", query, pm.filtered)
		}
	}

	// Empty query restores everything.
	pm.searchQuery = ""
	pm.applyFilterAndSort()
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected empty query to restore all rows, got %d/%d", len(pm.filtered), len(apps))
	}
}

func TestSearchComposesWithActiveTab(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Stripe", Role: "Frontend Engineer", Status: "Applied", Score: 4.5},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Applied", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterApplied)
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()

	if len(pm.filtered) != 1 || pm.filtered[0].Role != "Frontend Engineer" {
		t.Fatalf("expected applied+stripe to leave only Frontend Engineer, got %+v", pm.filtered)
	}
}

func TestSearchIsCaseInsensitive(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	for _, q := range []string{"anthropic", "ANTHROPIC", "AnThRoPiC"} {
		pm.searchQuery = q
		pm.applyFilterAndSort()
		if len(pm.filtered) != 1 {
			t.Fatalf("expected case-insensitive match for %q, got %d rows", q, len(pm.filtered))
		}
	}
}

func TestSearchEnterCommitsAndEscClearsCommittedQuery(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)

	// Open input and type "stripe".
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}
	for _, r := range "stripe" {
		pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if pm.searchQuery != "stripe" {
		t.Fatalf("expected query to live-update to 'stripe', got %q", pm.searchQuery)
	}
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Stripe" {
		t.Fatalf("expected live filter to leave only Stripe, got %+v", pm.filtered)
	}

	// Enter commits — input closes, query stays.
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if pm.searchInput {
		t.Fatal("expected Enter to close input")
	}
	if pm.searchQuery != "stripe" {
		t.Fatalf("expected Enter to keep committed query, got %q", pm.searchQuery)
	}

	// Esc on a committed query clears the search and restores the full list.
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc to clear committed query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected Esc to restore full list, got %d/%d", len(pm.filtered), len(apps))
	}
}

func TestSearchEscInInputCancelsAndClears(t *testing.T) {
	// Use multiple rows so the test catches a regression where Esc clears the query
	// but forgets to re-apply the filter — the visible count would stay at 1
	// otherwise even though the underlying state went stale.
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Globex", Role: "Platform Engineer", Status: "Evaluated", Score: 4.0},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.searchInput = true
	pm.searchQuery = "stri"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 {
		t.Fatalf("setup expected 1 row matching 'stri', got %d", len(pm.filtered))
	}

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchInput {
		t.Fatal("expected Esc in input mode to close input")
	}
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc in input mode to clear in-progress query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected Esc to re-expand filtered list to %d rows, got %d", len(apps), len(pm.filtered))
	}
}

func TestSearchResetsCursorOnQueryChange(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Acme", Role: "Backend Engineer", Status: "Evaluated", Score: 4.0},
		{Company: "Beta", Role: "Frontend Engineer", Status: "Evaluated", Score: 4.1},
		{Company: "Gamma", Role: "AI Engineer", Status: "Evaluated", Score: 4.2},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.cursor = 2

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})

	if pm.cursor != 0 {
		t.Fatalf("expected cursor to reset to 0 on query change, got %d", pm.cursor)
	}
	if pm.scrollOffset != 0 {
		t.Fatalf("expected scrollOffset to reset to 0 on query change, got %d", pm.scrollOffset)
	}
}

func TestSearchStatePreservedAcrossReload(t *testing.T) {
	initial := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend", Status: "Evaluated", Score: 4.6},
		{Company: "Acme", Role: "AI", Status: "Evaluated", Score: 4.0},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), initial, model.PipelineMetrics{Total: len(initial)}, "..", 120, 40)
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()

	refreshed := append([]model.CareerApplication{}, initial...)
	refreshed = append(refreshed, model.CareerApplication{Company: "Globex", Role: "Platform", Status: "Applied", Score: 4.3})

	reloaded := pm.WithReloadedData(refreshed, model.PipelineMetrics{Total: len(refreshed)})

	if reloaded.searchQuery != "stripe" {
		t.Fatalf("expected refresh to preserve search query, got %q", reloaded.searchQuery)
	}
	if len(reloaded.filtered) != 1 || reloaded.filtered[0].Company != "Stripe" {
		t.Fatalf("expected refresh+search to keep filter applied, got %+v", reloaded.filtered)
	}
}

func TestRejectedGhostedAndDiscardedTabsFilterCorrectly(t *testing.T) {
	apps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Rejected",
			Score:      3.4,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Discarded",
			Score:      2.1,
			ReportPath: "reports/002-beta.md",
		},
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/003-gamma.md",
		},
		{
			Company:    "Delta",
			Role:       "ML Engineer",
			Status:     "Ghosted",
			Score:      4.1,
			ReportPath: "reports/004-delta.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		apps,
		model.PipelineMetrics{Total: len(apps)},
		"..",
		120,
		40,
	)

	pm.activeTab = tabIndexForFilter(t, filterRejected)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Rejected" {
		t.Fatalf("expected rejected tab to isolate rejected rows, got %+v", pm.filtered)
	}

	pm.activeTab = tabIndexForFilter(t, filterDiscarded)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Discarded" {
		t.Fatalf("expected discarded tab to isolate discarded rows, got %+v", pm.filtered)
	}

	pm.activeTab = tabIndexForFilter(t, filterGhosted)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Ghosted" {
		t.Fatalf("expected ghosted tab to isolate ghosted rows, got %+v", pm.filtered)
	}
}

// Regression: with no committed search query, Esc must NOT close the screen.
// The help bar advertises only `q quit`, so Esc quitting silently was a bug
// that surfaced as accidental exits when users hit Esc to "back out" of the UI.
func TestEscWithoutQueryIsNoOp(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	if pm.searchQuery != "" {
		t.Fatalf("setup expected empty search query, got %q", pm.searchQuery)
	}

	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if cmd != nil {
		// PipelineClosedMsg used to fire here; ensure it doesn't anymore.
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineClosedMsg); ok {
				t.Fatalf("expected Esc with no query to be a no-op, got PipelineClosedMsg")
			}
			t.Fatalf("expected Esc with no query to return nil cmd, got %T", msg)
		}
	}
	if pm.searchInput {
		t.Fatal("Esc with no query should not toggle searchInput")
	}
}

// Regression: typing during search input must not synchronously fan out to
// loadCurrentReport. Reading reports per keystroke caused visible UI lag, so
// the load is deferred to commit (Enter) / cancel (Esc) instead.
func TestSearchTypingDoesNotLoadReports(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6, ReportPath: "reports/001-stripe.md"},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8, ReportPath: "reports/002-anthropic.md"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}

	// Typing must not trigger PipelineLoadReportMsg.
	for _, r := range "stri" {
		var cmd tea.Cmd
		pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		if cmd != nil {
			if msg := cmd(); msg != nil {
				if _, ok := msg.(PipelineLoadReportMsg); ok {
					t.Fatalf("typing rune %q should not emit PipelineLoadReportMsg", string(r))
				}
			}
		}
	}

	// Backspace must not trigger PipelineLoadReportMsg either.
	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineLoadReportMsg); ok {
				t.Fatal("Backspace during search input should not emit PipelineLoadReportMsg")
			}
		}
	}

	// Ctrl+U must not trigger PipelineLoadReportMsg either.
	pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyCtrlU})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineLoadReportMsg); ok {
				t.Fatal("Ctrl+U during search input should not emit PipelineLoadReportMsg")
			}
		}
	}
}

func TestEditInputDropsControlRunes(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 200, 40)
	pm.editInput, pm.editField = true, "role"
	pm, _ = pm.handleEdit(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("Senior\x00 Specialist\x01 II")})
	if pm.editValue != "Senior Specialist II" {
		t.Fatalf("expected control runes to be dropped, got %q", pm.editValue)
	}
}
