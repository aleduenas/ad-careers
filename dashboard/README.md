# Dashboard TUI

A Go terminal UI backed by local PostgreSQL. Follow [database setup](../documentation/guides/database.md) first. Both the dashboard and scripts use the repository .env connection settings.

## Prerequisites

- **Go 1.25 or newer (see dashboard/go.mod)** (`go version` to check) — only needed to build the binary once.

## Build

From the repo root:

```bash
cd dashboard
go build -o dashboard.exe .      # Windows
# go build -o dashboard .        # macOS / Linux
```

`go build` downloads the module dependencies automatically the first time. The binary is gitignored, so each person builds their own.

## Run

Point it at the repo root with `--path` (it defaults to the current directory):

```bash
# from the dashboard/ directory
./dashboard.exe --path ..        # Windows
# ./dashboard --path ..          # macOS / Linux

# or from the repo root
./dashboard/dashboard.exe --path .
```

**Windows shortcut:** run `dashboard/launch-dashboard.ps1` — it sets UTF-8 output and launches the binary against the repo root automatically, from wherever you cloned it.

## What it shows

- **Filter tabs** — All, Pending, Evaluated, Applied, Interview, Ghosted, Top ≥4, Rejected, Discarded (Pending rows show their permanent pipeline ID)
- **Sort modes** — by Score, status date (labelled for the tab: evaluated, applied, ...), added date, or Company (grouped view and the filter tabs already order by status)
- **Grouped or flat** view of the pipeline
- **Lazy-loaded report previews** — highlight a row to preview its evaluation report
- **Report-linked JD** — open a job report with Enter, then press `j` in the report hotbar to read its associated JD from PostgreSQL; Esc returns to the report
- **Always-visible compensation** — salary bands or required market estimates are prefetched into a fixed column for every row; missing evaluation output is shown as an explicit contract error, never a blank cell
- **Inline status and discard-reason pickers** — change status with `c`, or discard with a required reason using `x`
- **Artifact-aware Evaluated view** — generated CVs and letters sort to the top and carry `[CV]`, `[LETTER]`, or `[CV+LETTER]` badges

## Keys

Standard TUI navigation: arrow keys / `j` `k` to move, `Tab` to switch filter tabs, `Enter` to open a report preview, `q` to quit. The active keybindings are shown in the footer bar while it's running.

## Notes

- In **Pending**, press `v` to evaluate the selected role using the standalone CLI launcher.
- Press `c` on any role to choose Applied, Rejected, Interview, Offer, Pending, or Evaluated, in that order. Ghosted is automatic only and is not a manual choice. Moving a Discarded or Evaluated job to Pending queues it for evaluation again. Press `x` separately to discard it and choose Expired, Seniority mismatch, Wrong role, Wrong location, Duplicate, or Other. The Discarded view shows the reason beside the role.
- Search with `/` by company, role, notes, discard reason, or permanent report number such as `1016` or `#1016`.
- Every row labels when the job entered its current status and when it was added, immediately after the role name (for example, `applied 2026-09-20, added 2026-09-04`). Pending rows show only the added date. Unrecoverable pre-PostgreSQL transition dates are labeled `unknown`, never replaced with the cutover date. Applied jobs with no status change after more than 40 days move automatically to Ghosted when the dashboard refreshes.
- In **Pending**, press `J` to paste a job by hand. Enter the posting URL, company, role title, and full JD. Company suggestions come from existing pipeline history; use Up/Down and Tab to select one, or press Enter to retain a new spelling. Ctrl+S saves the JD body verbatim, allocates a permanent pipeline ID, and inserts it as Pending.
- Press `e` on any selected pipeline row to edit its URL, role, company, or JD. URL, role, and company are edited inline; JD opens in the configured external editor and is synchronized back to PostgreSQL when the editor closes.
- In **Evaluated**, jobs with generated application materials appear first and show `[CV]`, `[LETTER]`, or `[CV+LETTER]`. Press `d`, select **CV**, **Cover letter**, or **CV + cover letter**, and press Enter. Esc cancels. Existing artifacts for that role are regenerated. **CV + cover letter** starts the CV and the letter as two separate tasks (separate workers, prompts and logs in `t`), never one combined call.
- Press `t` to open the task monitor: the twelve most recently finished tasks first, then everything running now. A finished task shows `completed`, `failed (exit N)` or `interrupted`; a running task shows the phase its worker last reported and `(retry N)` when it is on a second attempt. Enter opens the selected task's log, including a running task's live log. The monitor refreshes when it opens and every second while it is open.
- `g`/`G` retain first/last-row navigation. The new `e`, `d`, and `t` actions do not conflict with existing shortcuts.
- Evaluation and drafting run **detached**: the dashboard starts the worker and lets go of it. Quitting the dashboard, closing the terminal or restarting does not stop work in flight, and `q` is never blocked — reopen the dashboard and `t` shows the same tasks, still running. Workers use the dashboard's configured repo path regardless of your terminal's working directory. Node and the configured subscription CLI must be installed and authenticated.
- The status line names each running task with its phase and retry, and reports each task that finishes while the dashboard is open. Task records live in `logs/dashboard/tasks/` and their output in `logs/dashboard/`; both are pruned with `node src/helpers/prune-logs.mjs`. Data and artifact links refresh automatically, including while tasks run. Review generated drafts before using them.
- Multiple evaluations, multiple document-generation tasks, and mixed evaluation/generation work can run concurrently for different jobs; duplicate tasks for the same job are blocked. Drafting also takes a backend output-folder lock. The status row lists every active job. Scans, status changes and normal quit wait until active tasks finish; navigation and viewing remain available.

- The dashboard reads job records, changes statuses with revision checks, and records discard reasons in PostgreSQL. Reports and generated documents remain local files.
- CVs, cover letters, and cover-letter briefs are matched from `output/{company}/{role-slug}--{job-id}/` — there is no artifact column in the tracker.
- Inside a role/report, use `o` for the application site, `c` for the CV, `l` for the generated cover letter, and `b` for its Markdown brief. Available actions are shown in the footer.
- Open a generated `cover-letter.md`, edit it as needed, then press `p` to publish a PDF. The publisher reads only that edited Markdown file; its temporary HTML and render log are archived under `logs/publishing`.
- If it shows an empty list, check that jobs have been ingested, the active filter matches them, and `--path` points at the repository root containing `.env` and `data/`. Database errors are displayed explicitly.
