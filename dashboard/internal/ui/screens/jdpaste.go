package screens

import (
	"fmt"
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"career-ops/dashboard/internal/data"
)

// PipelineSubmitJDMsg sends user-supplied intake fields to the pipeline. The
// script keeps the description verbatim and allocates the permanent job ID.
// Force is set once the user has confirmed past a "seen in a scan but never
// added" warning, so add-pasted-jd.mjs's own dedup check does not re-block it.
type PipelineSubmitJDMsg struct {
	URL     string
	Company string
	Role    string
	Text    string
	Force   bool
}

// PipelineCheckURLMsg asks the dashboard to check a pasted-JD URL against
// PostgreSQL before the flow moves past the URL step.
type PipelineCheckURLMsg struct{ URL string }

// PipelineURLCheckedMsg reports what PostgreSQL knows about that URL.
type PipelineURLCheckedMsg struct {
	URL  string
	Err  error
	data.URLTrackStatus
}

// handleJDPaste consumes a four-step URL, company, role and description flow.
func (m PipelineModel) handleJDPaste(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	input := ""
	if msg.Type == tea.KeyRunes && !msg.Alt {
		input = strings.Map(func(r rune) rune {
			if unicode.IsPrint(r) || r == '\n' || r == '\r' || r == '\t' {
				return r
			}
			return -1
		}, string(msg.Runes))
		input = strings.ReplaceAll(strings.ReplaceAll(input, "\r\n", "\n"), "\r", "\n")
	}
	if msg.String() == "esc" {
		m.clearJDPaste()
		return m, nil
	}

	switch m.jdPasteStage {
	case "url":
		if m.jdURLChecking {
			return m, nil
		}
		switch msg.String() {
		case "enter":
			if url := normalizeURL(m.jdPasteURL); url != "" {
				m.jdPasteURL = url
				m.jdURLChecking = true
				return m, func() tea.Msg { return PipelineCheckURLMsg{URL: url} }
			}
		case "backspace":
			runes := []rune(m.jdPasteURL)
			if len(runes) > 0 {
				m.jdPasteURL = string(runes[:len(runes)-1])
			}
		case "ctrl+u":
			m.jdPasteURL = ""
		default:
			m.jdPasteURL += strings.ReplaceAll(input, "\n", "")
		}
		return m, nil

	case "blocked":
		// Esc (full cancel) is handled above; any other key returns to the URL
		// step so the user can point the paste at a different posting.
		m.jdPasteStage = "url"
		return m, nil

	case "confirm":
		switch msg.String() {
		case "y", "enter":
			m.jdPasteStage = "company"
			m.jdForceDuplicate = true
		case "n":
			m.clearJDPaste()
		}
		return m, nil

	case "company":
		suggestions := m.jdCompanySuggestions()
		switch msg.String() {
		case "enter":
			if strings.TrimSpace(m.jdPasteCompany) != "" {
				m.jdPasteCompany = m.jdCanonicalCompany(suggestions)
				m.jdPasteStage = "role"
			}
		case "tab":
			if len(suggestions) > 0 {
				m.jdPasteCompany = suggestions[m.jdCompanyCursor]
			}
		case "up":
			if len(suggestions) > 0 {
				m.jdCompanyCursor = (m.jdCompanyCursor + len(suggestions) - 1) % len(suggestions)
			}
		case "down":
			if len(suggestions) > 0 {
				m.jdCompanyCursor = (m.jdCompanyCursor + 1) % len(suggestions)
			}
		case "backspace":
			runes := []rune(m.jdPasteCompany)
			if len(runes) > 0 {
				m.jdPasteCompany = string(runes[:len(runes)-1])
				m.jdCompanyCursor = 0
			}
		case "ctrl+u":
			m.jdPasteCompany, m.jdCompanyCursor = "", 0
		default:
			m.jdPasteCompany += strings.ReplaceAll(input, "\n", " ")
			m.jdCompanyCursor = 0
		}
		return m, nil

	case "role":
		switch msg.String() {
		case "enter":
			if strings.TrimSpace(m.jdPasteRole) != "" {
				m.jdPasteRole = strings.TrimSpace(m.jdPasteRole)
				m.jdPasteStage = "text"
			}
		case "backspace":
			runes := []rune(m.jdPasteRole)
			if len(runes) > 0 {
				m.jdPasteRole = string(runes[:len(runes)-1])
			}
		case "ctrl+u":
			m.jdPasteRole = ""
		default:
			m.jdPasteRole += strings.ReplaceAll(input, "\n", " ")
		}
		return m, nil

	case "text":
		switch msg.String() {
		case "ctrl+s":
			url, company, role, body := strings.TrimSpace(m.jdPasteURL), strings.TrimSpace(m.jdPasteCompany), strings.TrimSpace(m.jdPasteRole), m.jdPasteText
			if url == "" || company == "" || role == "" || strings.TrimSpace(body) == "" {
				return m, nil
			}
			force := m.jdForceDuplicate
			m.clearJDPaste()
			m.jdSubmitting, m.workflowLog = true, ""
			m.workflowStatus = "Saving pasted JD verbatim to the pipeline"
			return m, func() tea.Msg {
				return PipelineSubmitJDMsg{URL: url, Company: company, Role: role, Text: body, Force: force}
			}
		case "backspace":
			runes := []rune(m.jdPasteText)
			if len(runes) > 0 {
				m.jdPasteText = string(runes[:len(runes)-1])
			}
		case "ctrl+u":
			m.jdPasteText = ""
		case "enter":
			m.jdPasteText += "\n"
		default:
			m.jdPasteText += input
		}
		return m, nil
	}
	return m, nil
}

func (m *PipelineModel) clearJDPaste() {
	m.jdPasteStage, m.jdPasteURL, m.jdPasteCompany, m.jdPasteRole, m.jdPasteText = "", "", "", "", ""
	m.jdCompanyCursor = 0
	m.jdURLChecking, m.jdForceDuplicate = false, false
	m.jdDupJobNumber = 0
	m.jdDupJobCompany, m.jdDupJobRole, m.jdDupJobStatus = "", "", ""
	m.jdDupScanCompany, m.jdDupScanTitle, m.jdDupScanStatus, m.jdDupScanFirstSeen = "", "", "", ""
}

// handleURLChecked applies the result of a PipelineCheckURLMsg round trip. A
// stale response (e.g. from a check whose URL was since edited or the paste
// flow was cancelled) is dropped rather than reviving the form.
func (m PipelineModel) handleURLChecked(msg PipelineURLCheckedMsg) (PipelineModel, tea.Cmd) {
	if !m.jdURLChecking || msg.URL != m.jdPasteURL {
		return m, nil
	}
	m.jdURLChecking = false
	if msg.Err != nil {
		m.workflowStatus = "Could not check the URL against PostgreSQL: " + msg.Err.Error()
		return m, nil
	}
	if msg.TrackedAsJob {
		m.jdPasteStage = "blocked"
		m.jdDupJobNumber, m.jdDupJobCompany = msg.JobNumber, msg.JobCompany
		m.jdDupJobRole, m.jdDupJobStatus = msg.JobRole, msg.JobStatus
		return m, nil
	}
	if msg.SeenInScan {
		m.jdPasteStage = "confirm"
		m.jdDupScanCompany, m.jdDupScanTitle = msg.ScanCompany, msg.ScanTitle
		m.jdDupScanStatus, m.jdDupScanFirstSeen = msg.ScanStatus, msg.ScanFirstSeen
		return m, nil
	}
	m.jdPasteStage = "company"
	m.workflowStatus = "URL not previously tracked — verified unique ✓"
	return m, nil
}

func (m PipelineModel) jdCompanySuggestions() []string {
	query := strings.ToLower(strings.TrimSpace(m.jdPasteCompany))
	compactQuery := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, query)
	seen := make(map[string]bool)
	var matches []string
	for _, app := range m.apps {
		name, key := strings.TrimSpace(app.Company), strings.ToLower(strings.TrimSpace(app.Company))
		compactName := strings.Map(func(r rune) rune {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				return unicode.ToLower(r)
			}
			return -1
		}, key)
		if name == "" || seen[key] || (query != "" && !strings.Contains(key, query) && !strings.Contains(compactName, compactQuery)) {
			continue
		}
		seen[key] = true
		matches = append(matches, name)
	}
	return matches
}

func (m PipelineModel) jdCanonicalCompany(suggestions []string) string {
	entered := strings.TrimSpace(m.jdPasteCompany)
	for _, candidate := range suggestions {
		if strings.EqualFold(entered, candidate) {
			return candidate
		}
	}
	return entered
}

func normalizeURL(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, s)
	s = strings.Trim(s, "<>\"' \t")
	if s == "" {
		return ""
	}
	lower := strings.ToLower(s)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		s = "https://" + s
	}
	return s
}

func (m PipelineModel) renderJDPaste() string {
	padStyle := lipgloss.NewStyle().Padding(1, 2)
	labelStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	cursor := lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
	if m.jdPasteStage == "url" {
		hint := dimStyle.Render("Enter the posting URL, then press Enter to continue.")
		if m.jdURLChecking {
			hint = dimStyle.Render("Checking PostgreSQL for this URL...")
		}
		return padStyle.Render(strings.Join([]string{labelStyle.Render("Paste JD - step 1/4: job URL"), "", dimStyle.Render("URL: ") + m.jdPasteURL + cursor, "", hint}, "\n"))
	}
	if m.jdPasteStage == "blocked" {
		lines := []string{
			labelStyle.Render("Already in the pipeline"),
			"",
			dimStyle.Render("URL: ") + m.jdPasteURL,
			fmt.Sprintf("#%d — %s — %s (%s)", m.jdDupJobNumber, m.jdDupJobCompany, m.jdDupJobRole, m.jdDupJobStatus),
			"",
			dimStyle.Render("This URL already belongs to a tracked job, so adding it again would just"),
			dimStyle.Render("resync that job's JD. Open #" + fmt.Sprintf("%d", m.jdDupJobNumber) + " instead."),
			"",
			dimStyle.Render("Any key returns to the URL step. Esc cancels."),
		}
		return padStyle.Render(strings.Join(lines, "\n"))
	}
	if m.jdPasteStage == "confirm" {
		seen := dimStyle.Render("first seen " + m.jdDupScanFirstSeen)
		if m.jdDupScanFirstSeen == "" {
			seen = ""
		}
		lines := []string{
			labelStyle.Render("Seen before, but not tracked"),
			"",
			dimStyle.Render("URL: ") + m.jdPasteURL,
			fmt.Sprintf("A scan noticed %s — %s and marked it %q %s.", m.jdDupScanCompany, m.jdDupScanTitle, m.jdDupScanStatus, seen),
			dimStyle.Render("It was never added as a job, so this isn't a real duplicate."),
			"",
			"Continue adding it anyway? (y/n)",
		}
		return padStyle.Render(strings.Join(lines, "\n"))
	}
	if m.jdPasteStage == "company" {
		lines := []string{labelStyle.Render("Paste JD - step 2/4: company"), "", "Company: " + m.jdPasteCompany + cursor}
		if suggestions := m.jdCompanySuggestions(); len(suggestions) > 0 {
			lines = append(lines, "", dimStyle.Render("Existing companies (Up/Down then Tab selects):"))
			for i, suggestion := range suggestions {
				prefix := "  "
				if i == m.jdCompanyCursor {
					prefix = "> "
				}
				lines = append(lines, prefix+suggestion)
			}
		}
		lines = append(lines, "", dimStyle.Render("Enter keeps the typed company. A new name is added to history."))
		return padStyle.Render(strings.Join(lines, "\n"))
	}
	if m.jdPasteStage == "role" {
		return padStyle.Render(strings.Join([]string{labelStyle.Render("Paste JD - step 3/4: role title"), "", dimStyle.Render("Company: ") + m.jdPasteCompany, "Role: " + m.jdPasteRole + cursor, "", dimStyle.Render("Enter the role title, then press Enter to continue.")}, "\n"))
	}
	charCount, lineCount := len([]rune(m.jdPasteText)), 1
	if m.jdPasteText != "" {
		lineCount = strings.Count(m.jdPasteText, "\n") + 1
	}
	header := []string{labelStyle.Render("Paste JD - step 4/4: job description"), dimStyle.Render("Company: " + m.jdPasteCompany), dimStyle.Render("Role: " + m.jdPasteRole), dimStyle.Render("URL: " + truncateRunes(m.jdPasteURL, max(1, m.width-10))), dimStyle.Render(fmt.Sprintf("%d chars, %d lines", charCount, lineCount)), ""}
	footer := []string{"", dimStyle.Render("Paste the full JD, then Ctrl+S to save it verbatim. Ctrl+U clears. Esc cancels.")}
	avail := m.height - len(header) - len(footer) - 4
	if avail < 3 {
		avail = 3
	}
	bodyLines := []string{}
	if m.jdPasteText != "" {
		bodyLines = strings.Split(m.jdPasteText, "\n")
	}
	if len(bodyLines) > avail {
		bodyLines = bodyLines[len(bodyLines)-avail:]
	}
	preview := dimStyle.Render("(nothing pasted yet)") + cursor
	if len(bodyLines) > 0 {
		preview = strings.Join(bodyLines, "\n") + cursor
	}
	return padStyle.Render(strings.Join(append(append(header, preview), footer...), "\n"))
}
