# dashboard/internal/data/career_test.go

**Authority:** [dashboard/internal/data/career_test.go](../../../../dashboard/internal/data/career_test.go).

Checks exact and fuzzy interview-prep discovery, Interview-only enrichment, artifact discovery and rejection of unrelated or ambiguous output matches. Permanent-ID fixtures cover duplicate company/role postings, legacy fallback, exclusion of unrelated ID folders and duplicate-ID ambiguity.

## Run

`go test ./... (from dashboard/)`.

Discovered by the Go test runner; the Node quick suite does not run Go unit tests.

## Inputs, dependencies and side effects

Uses Go temporary fixture directories and internal model types. Exercises `career.go`; no PostgreSQL required.

