# Quick CI workflow

**Authority:** [.github/workflows/test.yml](../../../.github/workflows/test.yml).

Runs on pull requests to `main` using Ubuntu, Node 24 and the Go version in `dashboard/go.mod`. Installs npm dependencies and runs `node src/test-all.mjs --quick`, including documentation coverage. It does not build the dashboard or provision PostgreSQL; database-backed tests may report skips. Inputs are the checked-out tree and package manifests; outputs are CI logs and temporary test artifacts.

