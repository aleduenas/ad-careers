# Database CI workflow

**Authority:** [.github/workflows/database.yml](../../../.github/workflows/database.yml).

Runs on pushes and pull requests with Node 24 and the Go version in dashboard/go.mod.
After npm ci and the schema snapshot check, initializes the repository's Docker Compose
PostgreSQL service and installs Playwright Chromium with Linux dependencies. The isolated
db-test runner creates test databases and runs legacy import, database, evaluation,
drafting/publication, custom-format backup/restore and Go integration tests. A separate
PDF render check verifies bundled fonts. The always-run cleanup stops Compose.

No personal database or candidate configuration is required. Test launchers use synthetic
model responses; CI does not establish live subscription-provider availability.
