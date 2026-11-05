package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"career-ops/dashboard/internal/theme"
)

func TestViewerRoleArtifactActions(t *testing.T) {
	m := ViewerModel{
		title:      "LCBO — Senior Manager, Cybersecurity Operations",
		jobURL:     "https://example.com/apply",
		cvPath:     `C:\output\lcbo\cv-user.html`,
		letterPath: `C:\output\lcbo\cover-letter.html`,
		briefPath:  `C:\output\lcbo\cover-letter-brief.md`,
		prepPath:   `C:\interview-prep\lcbo.md`,
	}

	tests := []struct {
		key  rune
		want any
	}{
		{'o', ViewerOpenURLMsg{}},
		{'c', ViewerOpenCVMsg{}},
		{'l', ViewerOpenLetterMsg{}},
		{'b', ViewerOpenBriefMsg{}},
		{'i', ViewerOpenPrepMsg{}},
	}

	for _, tt := range tests {
		_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{tt.key}})
		if cmd == nil {
			t.Fatalf("key %q returned no command", string(tt.key))
		}
		got := cmd()
		switch tt.want.(type) {
		case ViewerOpenURLMsg:
			if msg, ok := got.(ViewerOpenURLMsg); !ok || msg.URL != m.jobURL {
				t.Fatalf("key o emitted %#v", got)
			}
		case ViewerOpenCVMsg:
			if msg, ok := got.(ViewerOpenCVMsg); !ok || msg.Path != m.cvPath {
				t.Fatalf("key c emitted %#v", got)
			}
		case ViewerOpenLetterMsg:
			if msg, ok := got.(ViewerOpenLetterMsg); !ok || msg.Path != m.letterPath {
				t.Fatalf("key l emitted %#v", got)
			}
		case ViewerOpenBriefMsg:
			if msg, ok := got.(ViewerOpenBriefMsg); !ok || msg.Path != m.briefPath {
				t.Fatalf("key b emitted %#v", got)
			}
		case ViewerOpenPrepMsg:
			if msg, ok := got.(ViewerOpenPrepMsg); !ok || msg.Path != m.prepPath {
				t.Fatalf("key i emitted %#v", got)
			}
		}
	}
}

func TestReportViewerJOpensJDAndJDViewerJScrolls(t *testing.T) {
	theme := theme.NewTheme("catppuccin-mocha")
	report := NewContentViewerModel(theme, "report.md", "Acme — Engineer",
		ViewerArtifacts{JobURL: "https://example.com/apply", JDJobID: 42, JDPath: "jd.md"},
		80, 12, []string{"Report"})
	if !strings.Contains(ansi.Strip(report.renderFooter()), "j job description") {
		t.Fatal("report hotbar omits the JD shortcut")
	}
	_, cmd := report.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	if cmd == nil {
		t.Fatal("j did not open the report's JD")
	}
	msg, ok := cmd().(ViewerOpenJDMsg)
	if !ok || msg.JobID != 42 || msg.Path != "jd.md" || msg.JobURL != "https://example.com/apply" {
		t.Fatalf("j emitted %#v", cmd())
	}
	jd := NewContentViewerModel(theme, "jd.md", msg.Title, ViewerArtifacts{}, 80, 12,
		strings.Split(strings.Repeat("description\n\n", 20), "\n"))
	jd, cmd = jd.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	if cmd != nil || jd.scrollOffset != 1 {
		t.Fatalf("j in JD viewer should scroll, got offset %d and command %#v", jd.scrollOffset, cmd)
	}
}

func TestViewerCoverLetterEditAndPublishActions(t *testing.T) {
	m := ViewerModel{
		title: "Affirm — Machine Learning Engineer II",
		path:  `C:\output\affirm\mle-ii\cover-letter.md`,
	}

	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}})
	if cmd == nil {
		t.Fatal("key e returned no command for a cover letter")
	}
	if msg, ok := cmd().(ViewerEditMsg); !ok || msg.Path != m.path {
		t.Fatalf("key e emitted %#v", cmd())
	}

	_, cmd = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	if cmd == nil {
		t.Fatal("key p returned no command for a cover letter")
	}
	if msg, ok := cmd().(ViewerPublishPDFMsg); !ok || msg.Path != m.path {
		t.Fatalf("key p emitted %#v", cmd())
	}

	notLetter := ViewerModel{path: `C:\output\affirm\mle-ii\cover-letter-brief.md`}
	if _, cmd := notLetter.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}); cmd != nil {
		t.Fatalf("key e should be inert for a non-cover-letter file, got %#v", cmd())
	}
}

func TestViewerBusyBlocksReentryAndDoneMessagesClearIt(t *testing.T) {
	m := ViewerModel{path: `C:\output\affirm\mle-ii\cover-letter.md`}

	m, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	if cmd == nil || !m.busy {
		t.Fatal("expected publish to set busy")
	}

	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}}); cmd != nil {
		t.Fatalf("expected busy viewer to ignore a second publish request, got %#v", cmd())
	}

	m, _ = m.Update(ViewerPublishPDFDoneMsg{PDFPath: `C:\output\affirm\mle-ii\cover-letter.pdf`})
	if m.busy {
		t.Fatal("expected done message to clear busy")
	}
	if !strings.Contains(m.status, "Published") {
		t.Fatalf("expected success status, got %q", m.status)
	}
}

func TestViewerRebuildRenderClampsScrollOffset(t *testing.T) {
	m := ViewerModel{
		lines:        []string{"short"},
		scrollOffset: 20,
		width:        80,
		height:       20,
		theme:        theme.NewTheme("catppuccin-mocha"),
	}

	m.rebuildRender()

	maxScroll := len(m.renderedLines) - m.bodyHeight()
	if maxScroll < 0 {
		maxScroll = 0
	}
	if m.scrollOffset > maxScroll {
		t.Fatalf("expected scrollOffset <= %d after rebuild, got %d", maxScroll, m.scrollOffset)
	}
}

func TestRenderInlineElementsLeavesTrailingPunctuationUnstyled(t *testing.T) {
	match := reBareURL.FindString("Visit https://example.com.")

	if match != "https://example.com" {
		t.Fatalf("expected URL match without trailing period, got %q", match)
	}
}

func TestViewerWrapsFencedCodeLines(t *testing.T) {
	m := ViewerModel{
		lines: []string{
			"```",
			strings.Repeat("x", 40),
			"```",
		},
		width:  20,
		height: 20,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := m.renderAll()
	maxWidth := m.width - 6
	if maxWidth < 10 {
		maxWidth = 10
	}

	if len(rendered) < 2 {
		t.Fatalf("expected fenced code to wrap into multiple lines, got %d", len(rendered))
	}
	for _, line := range rendered {
		if width := ansi.StringWidth(line); width > maxWidth {
			t.Fatalf("expected fenced code line width <= %d, got %d for %q", maxWidth, width, ansi.Strip(line))
		}
	}
}

func TestViewerRendersInlineMarkdownBeforeParagraphWrapping(t *testing.T) {
	m := ViewerModel{
		lines: []string{
			"See [documentation](https://example.com/really-long-path) before continuing.",
		},
		width:  30,
		height: 20,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := strings.Join(m.renderAll(), "\n")
	plain := ansi.Strip(rendered)

	if strings.Contains(plain, "[") || strings.Contains(plain, "](") {
		t.Fatalf("expected rendered paragraph to hide markdown link syntax, got %q", plain)
	}
	if !strings.Contains(plain, "documentation") {
		t.Fatalf("expected rendered paragraph to keep link text, got %q", plain)
	}
}

func TestViewerEmptyContentRendersPlaceholder(t *testing.T) {
	m := ViewerModel{
		lines:  nil,
		width:  40,
		height: 10,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}
	m.rebuildRender()

	if len(m.renderedLines) != 0 {
		t.Fatalf("expected zero rendered lines for empty content, got %d", len(m.renderedLines))
	}

	body := ansi.Strip(m.renderBody())
	if !strings.Contains(body, "(empty file)") {
		t.Fatalf("expected empty placeholder, got %q", body)
	}
}

func TestViewerInlineRenderingHandlesMixedTokens(t *testing.T) {
	m := ViewerModel{
		width:  60,
		height: 10,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := m.renderInlineElementsAs(
		"start `code` mid **bold** then [link](https://example.com) end https://bare.example.com.",
		m.theme.Subtext,
	)
	plain := ansi.Strip(rendered)

	for _, want := range []string{"start ", "code", " mid ", "bold", " then ", "link", " end ", "https://bare.example.com"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("expected plain output to contain %q, got %q", want, plain)
		}
	}
	for _, syntax := range []string{"`", "**", "[", "](", "](http"} {
		if strings.Contains(plain, syntax) {
			t.Fatalf("expected markdown syntax %q to be hidden, got %q", syntax, plain)
		}
	}
	if strings.HasSuffix(plain, ".") == false {
		t.Fatalf("expected trailing punctuation outside the bare URL, got %q", plain)
	}
}

func TestViewerIndentsWrappedBlockquoteLines(t *testing.T) {
	m := ViewerModel{
		width:  24,
		height: 20,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := m.styleLine("> " + strings.Repeat("quoted ", 8))
	lines := strings.Split(ansi.Strip(rendered), "\n")

	if len(lines) < 2 {
		t.Fatalf("expected wrapped blockquote to render multiple lines, got %d", len(lines))
	}
	if !strings.HasPrefix(lines[0], "▎ ") {
		t.Fatalf("expected first blockquote line to keep border, got %q", lines[0])
	}
	if !strings.HasPrefix(lines[1], "  ") {
		t.Fatalf("expected wrapped blockquote continuation to align with text, got %q", lines[1])
	}
}
