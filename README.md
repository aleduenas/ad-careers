# career-ops

A local, dashboard-first job-search backend: scan employer portals, keep every posting and its
status in PostgreSQL, evaluate roles against a candidate profile with an isolated LLM worker, and
draft tailored CVs and cover letters as PDFs. Everything runs on your machine; the LLM calls use your
own Claude or ChatGPT subscription login, never API keys.

## Map

Each folder has one concise README, and that is all the documentation; there are no per-file pages.

| Folder | README covers |
|---|---|
| [`src/`](src/README.md) | Launchers and every command, the evaluation and drafting runbooks, the server API, tests, the rules maintainers must keep |
| [`infra/`](infra/README.md) | PostgreSQL, statuses, migrations, backup and restore, the isolated test database, CI |
| [`llm/`](llm/README.md) | Prompts, the launcher and prompt contract, the scoring rubric, compact candidate inputs |
| [`config/`](config/README.md) | Private settings and candidate documents, what each action needs, the private-versus-system data contract |
| [`web/`](web/README.md) | The React dashboard: module map and rules |
| `.github/workflows/` | `test.yml` runs the quick suite on pull requests; `database.yml` runs schema check, `db-test` and the PDF render test on every push |

`AGENTS.md` (and `CLAUDE.md`) are the rules for AI sessions that work on this repository.
`data/`, `output/` and `logs/` hold private work product and run evidence; see `config/README.md`.

## Requirements

- Windows 11 (the service launcher and Docker setup script target Windows; the Node code is portable)
- Node.js 24, Docker Desktop
- A Claude Code (`claude`) and/or Codex (`codex`) CLI with a subscription login

## Quick start

```bash
npm install
npx playwright install chromium          # PDF rendering and browser fallbacks
node src/helpers/db-infra.mjs init       # creates the private .env with a random password
npm run db:up                            # PostgreSQL via Docker Compose
npm run db:migrate                       # applies infra/sql/migrations/
cp config/examples/profile.example.yml config/profile.yml
cp config/examples/portals.example.yml config/portals.yml
# then write config/cv.md, config/profile.md and the compact twins under llm/compacted/
npm run web:build
npm run web:start                        # the dashboard at http://localhost:4310
```

Check the setup with `node src/test-all.mjs --quick`, `node src/helpers/verify-portals.mjs`,
`node src/cvgen/draft-cv.mjs --doctor` and `node src/eval/evaluate-jobs.mjs --doctor`.
`config/README.md` lists which private files each dashboard action needs.

For an always-on dashboard run `npm run web:install` once: it starts at every Windows logon with no
administrator rights and no window, restarts within a minute if it crashes, and waits up to five
minutes for PostgreSQL. After `npm run web:build`, run `npm run web:restart`. `web:status`, `web:down`
and `web:uninstall` do what they say; the log is `logs/dashboard/server.log`.

## Everyday commands

```bash
node src/test-all.mjs --quick            # before reporting any change done; npm test adds the web build
node src/helpers/db-test.mjs             # isolated PostgreSQL integration tests
npm run db:backup                        # dump into data/backups/
node src/helpers/prune-logs.mjs          # retention policy, dry run by default
```

## Privacy

`config/`, `llm/compacted/`, `data/`, `output/` and `logs/` are gitignored. Nothing about the candidate
is committed; the repository holds code, prompts and READMEs only.
