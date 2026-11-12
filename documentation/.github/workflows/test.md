# Quick CI workflow

**Authority:** [.github/workflows/test.yml](../../../.github/workflows/test.yml).

Runs on pull requests to `main` using Ubuntu and Node 24. Installs npm dependencies and runs `node src/test-all.mjs --quick`, including documentation coverage. It does not run the web production build or provision PostgreSQL; database-backed tests may report skips. Inputs are the checked-out tree and package manifests; outputs are CI logs and temporary test artifacts.

