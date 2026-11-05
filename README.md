# career-ops

A local, dashboard-first job-search backend: scan employer portals, keep every posting and its
status in PostgreSQL, evaluate roles against a candidate profile with an isolated LLM worker,
and draft tailored CVs and cover letters as PDFs. Everything runs on your machine; the LLM calls
use your own Claude or ChatGPT subscription login, never API keys.

Full documentation lives in [`documentation/`](documentation/index.md). The folder structure and
the rules the code follows are in
[`documentation/guides/layout.md`](documentation/guides/layout.md).

## What it does

| Action (dashboard) | Backend | Result |
|---|---|---|
| Scan | `src/scan/scan.mjs` + `src/scan/providers/` | New postings with full job descriptions, deduplicated, stored in PostgreSQL and cached under `data/jds/` |
| Paste a JD | `src/scan/add-pasted-jd.mjs` | A job created from a posting you paste, JD kept verbatim |
| Evaluate | `src/eval/evaluate-jobs.mjs` | Location gate, cached company/market research, an 8-dimension scored report in `data/evaluations/` |
| CV | `src/cvgen/draft-cv.mjs` | A rendered CV PDF in `output/<company>/<role>--<job-id>/` |
| Cover letter | `src/cvgen/draft-cover-letter.mjs` | An editable `cover-letter.md` in the same folder, drafted by its own call |
| CV + cover letter | both of the above | Two separate background tasks, never one combined call |
| Publish letter | `src/cvgen/publish-cover-letter.mjs` | The edited letter as a PDF |
| Status changes, viewing | Go TUI in `dashboard/` | Revision-checked status transitions; reports, CVs, letters and interview prep opened from the pipeline |

## Requirements

- Windows 11 (the dashboard launcher and Docker setup script target Windows; the Node and Go code are portable)
- Node.js 24, Go 1.25 or newer (see `dashboard/go.mod`), Docker Desktop
- A Claude Code (`claude`) and/or Codex (`codex`) CLI with a subscription login

## Quick start

```bash
npm install
npx playwright install chromium          # PDF rendering and browser fallbacks
node src/helpers/db-infra.mjs init       # creates private .env with a random password
npm run db:up                            # PostgreSQL via Docker Compose
npm run db:migrate                       # applies infra/sql/migrations/
cp config/examples/profile.example.yml config/profile.yml
cp config/examples/portals.example.yml config/portals.yml
# then write config/cv.md, config/profile.md and the compact twins under llm/compacted/
cd dashboard && go build -o dashboard.exe . && cd ..
dashboard/launch-dashboard.ps1
```

The step-by-step version, including which private files must exist before each action works, is
[`documentation/guides/SETUP.md`](documentation/guides/SETUP.md).

## Layout

```
src/            backend: lib/ helpers/ cvgen/ eval/ scan/ analytics/ test-all.mjs
llm/            prompts the LLM workers read; compacted/ (private) token-cheap candidate inputs
infra/          sql/ migrations + schema snapshot; docker/ compose and setup
dashboard/      Go TUI and the built dashboard.exe
config/         (private) candidate documents and runtime settings; examples/ tracked
data/           (private) jds/ evaluations/ company-info/ interview-prep/ writing-samples/ archive/ backups/
output/         (private) generated CVs and letters per company/role
logs/           (private) run evidence
documentation/  index, guides, one page per source file, history
```

## Everyday commands

```bash
npm test                                 # full suite incl. dashboard build; --quick via node src/test-all.mjs --quick
node src/helpers/db-test.mjs             # isolated PostgreSQL + launcher + Go integration tests
npm run db:backup                        # custom-format dump into data/backups/
node src/helpers/verify-pipeline.mjs     # every stored report/JD path resolves
node src/helpers/prune-logs.mjs          # retention policy, dry-run by default
```

Every command is listed in [`documentation/guides/SCRIPTS.md`](documentation/guides/SCRIPTS.md).

## Privacy

`config/`, `llm/compacted/`, `data/`, `output/` and `logs/` are gitignored. Nothing about the
candidate is committed; the repository holds code, prompts and documentation only.
