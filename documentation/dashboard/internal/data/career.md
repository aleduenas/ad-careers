# dashboard/internal/data/career.go

**Authority:** [dashboard/internal/data/career.go](../../../../dashboard/internal/data/career.go).

Enriches applications with local artifacts/report summaries and computes display metrics.

## Inputs

Reads `output/`, `data/interview-prep/` and referenced evaluation reports; accepts application slices for pipeline/progress statistics.

## Outputs and behavior

Returns artifact paths, report summaries, status priorities and metrics without writing files. Ghosted is treated as an application that reached Applied but is no longer active. A compensation band of `UNKNOWN` (with or without an explanation) or `Not assessed` is returned as empty so the pipeline only shows real figures. Artifact matching first resolves the permanent job ID in `<role>--<job-id>` folders, rejecting duplicate ID folders. If no ID folder exists, it checks legacy company/role folders and rejects ambiguous fuzzy matches. ID folders never participate in another job's legacy fallback. Interview-prep enrichment is restricted to Interview jobs.

## Dependencies and callers

Imports internal model types and Go fs/path/regexp/sort/string/time utilities. Used by `database.go`, `main.go` and screens. `NormalizeStatus` lowercases canonical database labels; it is not a legacy alias converter. Current and historical report formats have regression coverage.
