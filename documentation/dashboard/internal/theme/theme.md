# dashboard/internal/theme/theme.go

**Authority:** [dashboard/internal/theme/theme.go](../../../../dashboard/internal/theme/theme.go).

Defines the theme palette and selects a light or dark theme.

## Inputs

`NewTheme(name)` accepts `catppuccin-mocha`, `catppuccin-latte`, `auto` or empty; automatic selection checks the terminal background.

## Outputs and behavior

Returns a `Theme` of Lip Gloss colors; unknown names fall back to Mocha. No persistent writes.

## Dependencies and callers

Imports Lip Gloss and termenv. Uses the two palette files and is consumed by `main.go` and all screens.

