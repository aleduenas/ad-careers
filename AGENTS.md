# career-ops: rules for AI development sessions

This file is read by AI coding sessions (Claude Code, Codex and similar) that work **on** this
repository. It contains no career context on purpose: the LLM workers that do the project's
actual work (evaluating jobs, drafting CVs) read `llm/`, never this file, and this file never
needs to know who the candidate is. Development-session and worker instructions never mix:
`AGENTS.md` and `.claude/` carry no career context, and `llm/` carries no maintenance instructions.

## What this repository is

A dashboard-first job-search backend. The browser dashboard (`web/`, served by the local Node server
in `src/server/`) is the product; it runs deterministic Node launchers under `src/` (scan portals,
ingest a pasted JD, evaluate a job, draft a CV or cover letter, publish a PDF). Launchers make
isolated subscription-CLI calls with versioned prompts from `llm/prompts/`. PostgreSQL (`infra/`) is
the only operational store. The documentation is one concise README at the top of each root folder
(`src/`, `infra/`, `llm/`, `config/`, `web/`) plus the root `README.md`; start every task by reading the
README of the folder you will change.

There is no conversational workflow layer any more: the former `modes/` and skill routers were
retired on 2026-09-19 (archive under `data/archive/modes-retired-2026/`). A session's job here is
code maintenance, running documented commands, and keeping documentation in step with code.

## Hard rules

1. **PostgreSQL owns jobs, statuses, scores, evaluation history and ID allocation.** Never add a
   writable file store or a fallback tracker. Status writes go through the SQL transition
   functions (`src/helpers/move-status.mjs`, the dashboard) and check the expected revision.
   Database unavailability is an error, not a reason to improvise. Statuses are exactly the labels
   in the `jobs.status` CHECK constraint (`infra/sql/schema.sql`; readable list in
   `infra/README.md`).
2. **Migrations are immutable.** Schema or data changes are new numbered files in
   `infra/sql/migrations/`; regenerate `infra/sql/schema.sql` with `node src/helpers/db-schema.mjs`.
   Never edit an applied migration.
3. **Private data stays private.** `config/` (except README and `examples/`), `llm/compacted/`,
   `data/`, `output/`, `logs/` are gitignored candidate material or work product. Never commit them,
   never quote candidate facts into `src/`, `llm/prompts/`, `web/`, any README or this
   file. Facts enter prompts only at run time from `config/` and `llm/compacted/`.
4. **Never sync from any upstream remote.** This copy diverged permanently; there is no update
   mechanism.
5. **JD policy.** Job descriptions come from `data/jds/` and the `job_descriptions` table, written
   by scanning or pasted-JD intake. Never fetch JD text with a browser or web tool during
   evaluation or drafting. Known posting URLs are never re-inserted (unique constraint).
6. **Ethical use.** Quality over quantity. Never submit an application on the user's behalf; stop
   before any Submit/Send/Apply action. Every generated CV, letter or answer is a draft the user
   reviews.
7. **No unrequested side effects.** Evaluating a job never generates a CV or PDF; scoring is never
   a gate on any explicit user action. Two documented, server-owned rules change a status by
   themselves, and no other code may: Ghosted (`src/server/ghosting.mjs`: Applied with no response
   for 40 days) and the posting check (`src/scan/liveness.mjs`: a posting that closed before the
   user applied becomes Discarded with reason "Posting expired"; it runs daily, and
   `LIVENESS_DAILY_ENABLED` in `src/server/app.mjs` switches that off). Both go through the SQL
   transition functions.
8. **Tests and builds.** `node src/test-all.mjs --quick` before reporting done (`npm test` runs the
   full suite including the web production build). Isolated database integration: `node
   src/helpers/db-test.mjs` (never against the personal database).
9. **Documentation is one concise README per root folder, updated in the same change.** There are no
   per-file pages. Say what is not obvious from the code and drop what restates it: no history, no
   decisions log, no inventory of files. A change that alters a command, an API route, a table, a prompt
   placeholder or a rule updates the README of its folder; `src/test-all.mjs` checks that each root
   folder has one. Launcher and prompt are a pair: a placeholder or response key renamed in one is
   renamed in the other.
10. **Shell policy.** Prefer the documented scripts over ad hoc shell or SQL. Anything that mutates
    data runs in dry-run mode first (`prune-logs`, `sync-jds`, `import-legacy` all default to
    read-only).

## Where things are

| Need | Go to |
|---|---|
| Launchers, every CLI command, evaluation and drafting runbooks, server API, tests | `src/README.md` |
| Database, statuses, migrations, backup and restore, isolated test database, CI | `infra/README.md` |
| Prompts, the launcher and prompt contract, the scoring rubric (authority `llm/prompts/eval/scoring.md`) | `llm/README.md` |
| Private settings, candidate documents, readiness per action, private versus system files | `config/README.md` |
| Browser dashboard source and rules | `web/README.md` |
| Project overview, setup | `README.md` |

## hiring.cafe provider contract (mandatory)

hiring.cafe is a standard scan provider (`src/scan/providers/hiring-cafe.mjs`), run through
`node src/scan/scan.mjs`; no agent-side browsing.

- Use hiring.cafe only for discovery through its public `/jobs/{role-slug}` pages. Never fetch
  protected `/job/{id}` detail pages or reintroduce the retired search API.
- Open each uncached role search in a fresh browser context. On the first `403` or `429`, stop
  live hiring.cafe requests for that run and use eligible cached search results; do not add proxy
  rotation or challenge-bypass logic.
- Resolve the full JD from the search hit or the employer's canonical ATS/careers URL through
  `src/scan/providers/_canonical-jd.mjs`, including its rendered public-careers fallback when
  structured HTTP extraction is insufficient. Keep the hiring.cafe AI summary as clearly labelled
  metadata, never as the JD itself.
- Apply title, location, URL and company-role dedup filters before canonical JD retrieval;
  canonical retrieval is bounded globally and per host.
- A result without a full canonical JD is deferred: not cached under `data/jds/`, not inserted,
  not recorded as seen; the scan summary lists it under `Missing full JD`.
- `data/hiring-cafe-search-cache.json` is generated state. Normal scans refresh it; `--dry-run`
  may read it but must not write it.

## Conventions

Node ESM (`.mjs`), YAML/JSON configuration, Playwright for PDF rendering and browser fallbacks,
React/Vite/TypeScript for the browser dashboard. All `.mjs` source is formatted with Prettier
(`.prettierrc.json`, printWidth 100, 2-space indent, single quotes, semicolons, trailing commas);
this is the JS/TS equivalent of PEP 8. Run `npx prettier --write <file>` after editing a `.mjs`
file, or `npm run format` for the whole tree; `npm run format:check` verifies without writing.
Report outcomes faithfully: failing tests are reported as failing, skipped steps as skipped.
