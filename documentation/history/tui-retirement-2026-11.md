# Go TUI retirement (2026-11-12)

The owner accepted the browser dashboard as the replacement for the Go terminal dashboard
(decision D065) and asked for the TUI to be removed. Package 4.4 did it.

## What was removed

- `dashboard/`: all Go source, `go.mod`, `go.sum`, the README, `launch-dashboard.ps1`, the
  `internal/` packages and their tests, plus the untracked `dashboard.exe`, `dashboard.exe~`,
  `dash.lnk` and the local Go build cache.
- `documentation/dashboard/`: every mirrored page for those files.
- The Go build step and the `*.go` documentation-coverage entry in `src/test-all.mjs`, the
  `go test` step in `src/helpers/db-test.mjs`, and the Go toolchain setup in the two GitHub
  workflows. The ignore entries for the executable, shortcut, launch log and Go cache.
- `AGENTS.md` lines that called the TUI the product and required rebuilding `dashboard.exe`.

No Go toolchain is needed for any supported command any more.

## What was kept

- `logs/dashboard/tasks/` task records and the `logs/dashboard/*.log` task logs. The browser
  Runs list shows the records read-only as `legacy` rows (`src/server/legacy-runs.mjs`, format in
  `documentation/src/server/legacy-runs.md`). `node src/helpers/legacy-tasks.mjs` audits them.
- The TUI launch log, moved to `logs/dashboard/tui-launch-log.txt` (private, gitignored).
- Migration 009 (salary band) and 010 (browser runs). Both stay; nothing in the schema was
  TUI-specific.

## How to restore

The last commit that contains the TUI is `f428344`. In a checkout with a Go toolchain (1.25 or
newer):

```bash
git checkout f428344 -- dashboard
cd dashboard && go build -o dashboard.exe .
```

The restored TUI reads the same PostgreSQL schema. See
`documentation/dashboard-migration/design/ROLLBACK.md` for the database side.
