# career-ops documentation

Everything written about how this repository works. The layout it documents is defined in
[guides/layout.md](guides/layout.md); read that first. Per-file pages cover the backend, prompts, dashboard, infrastructure and configuration.
The [file reference](reference.md) links every page; `src/test-all.mjs` checks source coverage.

Convention: a document says at the top which file or table is the *authority* for the
behaviour it describes, so documentation never competes with the thing it documents.

## Start here

| Document | What it covers |
|---|---|
| [guides/layout.md](guides/layout.md) | The folder structure and the rules we adhere to |
| [guides/SETUP.md](guides/SETUP.md) | Installing prerequisites, PostgreSQL, first run |
| [guides/ARCHITECTURE.md](guides/ARCHITECTURE.md) | How the dashboard, launchers, prompts and PostgreSQL fit together |
| [guides/DATA_CONTRACT.md](guides/DATA_CONTRACT.md) | Private vs system files and what may be auto-updated |
| [guides/SCRIPTS.md](guides/SCRIPTS.md) | Every CLI entry point |
| [guides/CUSTOMIZATION.md](guides/CUSTOMIZATION.md) | Where to change targeting, rubric, templates |

## Components

| Document | What it covers |
|---|---|
| [../dashboard/README.md](../dashboard/README.md) | The Go TUI: launching, actions, logs, rebuild rule |
| [guides/database.md](guides/database.md) | PostgreSQL schema, migrations, statuses, backup and restore, legacy recovery |
| [guides/prompts.md](guides/prompts.md) | The prompt contracts under `llm/prompts/` |
| [../llm/prompts/eval/INDEX.md](../llm/prompts/eval/INDEX.md) | Every input substituted into the evaluation prompts |
| [guides/templates.md](guides/templates.md) | Rendering templates and configuration examples |
| [../data/writing-samples/README.md](../data/writing-samples/README.md) | Private writing style sources and sample bank |

## Workflows

| Document | What it covers |
|---|---|
| [guides/EVALUATION_CLI.md](guides/EVALUATION_CLI.md) | Running job evaluations: preparation, research cache, repair, resume, publication |
| [guides/scoring-rubric.md](guides/scoring-rubric.md) | Why the rubric has its dimensions and weights; the rubric itself is `llm/prompts/eval/scoring.md` |
| [guides/CV_DRAFTING.md](guides/CV_DRAFTING.md) | Generating a CV or cover letter through the isolated CLI and rendering the PDF |

## Candidate material

Lives in `config/` (private): `profile.md` (who the candidate is and what they want; the
evaluator receives its compact twin `llm/compacted/candidate-targeting.md`), `cv.md` (full CV;
compact twin `llm/compacted/cv-compact.md`), `cv-guidance.md`. Nothing under `documentation/`
contains candidate facts.

## Completion and remaining work

The [completion report](history/audit-plan/07-completion.md) records the finished documentation
and implementation follow-ups, live-generation validation evidence, and remaining manual review limits.

## History

| Document | What it covers |
|---|---|
| [history/repository-cleanup-audit-2026-09-19.md](history/repository-cleanup-audit-2026-09-19.md) | Full audit of the working tree with findings F01–F18 |
| [history/audit-plan/README.md](history/audit-plan/README.md) | The action plan derived from that audit and its decision sessions |
| [history/proposedfolders.txt](history/proposedfolders.txt) | The folder sketch that became `guides/layout.md` |
| [history/jd-storage-solution.md](history/jd-storage-solution.md) | Early JD storage design (superseded by `infra/sql/schema.sql`) |
| [history/PLAYWRIGHT_MCP.md](history/PLAYWRIGHT_MCP.md) | Notes on the Playwright MCP server used by interactive sessions |
| `data/archive/modes-retired-2026/README.md` | The retired agent workflow modes and the capability each represented |
