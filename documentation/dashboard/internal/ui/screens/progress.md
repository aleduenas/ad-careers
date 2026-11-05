# dashboard/internal/ui/screens/progress.go

**Authority:** [dashboard/internal/ui/screens/progress.go](../../../../../dashboard/internal/ui/screens/progress.go).

Displays pipeline analytics as a read-only progress screen.

## Inputs

Accepts precomputed `model.ProgressMetrics`, theme and terminal dimensions.

## Outputs and behavior

Renders funnel, score distribution, rates and weekly activity; handles scrolling/resizing and emits a close message. No database mutations or disk writes.

## Dependencies and callers

Imports internal model/theme, Bubble Tea, Lip Gloss and Go formatting/math/string utilities. Created by `main.go`; metric definitions/calculation live in internal model/data.

