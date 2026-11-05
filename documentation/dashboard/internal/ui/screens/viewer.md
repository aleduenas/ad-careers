# dashboard/internal/ui/screens/viewer.go

**Authority:** [dashboard/internal/ui/screens/viewer.go](../../../../../dashboard/internal/ui/screens/viewer.go).

Renders reports, JDs, letters and preparation documents in the terminal.

## Inputs

Loads file lines or accepts database-backed content; normalizes CRLF and renders Markdown headings, tables, lists, fenced code, links and inline styling at the current width.

## Outputs and behavior

Maintains scrolling and emits open/edit/publish/close messages. A report with an associated JD shows `j job description` in its hotbar and emits `ViewerOpenJDMsg` on `j`; other viewers retain `j` for scrolling. Letter edit/publish actions apply to cover-letter drafts; busy state prevents reentry until completion. External processes are launched by `main.go`.

## Dependencies and callers

Imports Bubble Tea, Lip Gloss, theme and Go text/filesystem utilities. Used by `main.go`; behavior and wrapping regressions are covered by `viewer_test.go`.
