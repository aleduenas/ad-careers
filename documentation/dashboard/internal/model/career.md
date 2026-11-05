# dashboard/internal/model/career.go

**Authority:** [dashboard/internal/model/career.go](../../../../dashboard/internal/model/career.go).

Defines the dashboard's shared application and analytics data structures.

## Inputs

Applications carry permanent IDs, revisions, added/source dates, current-status occurrence dates, canonical statuses, latest discard reasons, scores, report/JD paths and enriched artifact/summary fields.

## Outputs and behavior

Exports `CareerApplication`, `PipelineMetrics`, `ProgressMetrics`, `FunnelStage`, `ScoreBucket` and `WeekActivity`. Pure data definitions; no I/O.

## Dependencies and callers

No imports. Used by internal data calculations, screens and the main application. SQL remains authoritative for persisted constraints.
