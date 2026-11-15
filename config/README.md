# config

Private candidate documents and runtime settings. Everything here is gitignored except this README
and `examples/`. This README is the whole documentation for this branch, and it also holds the
repository's private-versus-system data contract. Start a new setup by copying `examples/*` here and
removing `.example` from the names.

## Candidate documents

Full-size and human-readable. The LLM workers get compact twins under `llm/compacted/`; a change to
one of a pair is made in the other in the same edit (both carry a sync note).

| File | Compact twin | Notes |
|---|---|---|
| `profile.md` | `llm/compacted/candidate-targeting.md` | Who the candidate is, targets, compensation, location, negotiation, evaluation rulings. |
| `cv.md` | `llm/compacted/cv-compact.md` | Canonical CV. `## Professional Experience`, `## Projects`, `## Education` with `### Title \| Organization \| Dates` entries; each experience or project carries `<!-- slot: key -->` matching the worksheet keys in `llm/prompts/cvgen/cv-worksheet.md`; education entries carry a `**CV description:**` line. The renderer reads this file; CLI workers read the twin. |
| `cv-guidance.md` | none | CV presentation guardrails; reference only, no script loads it. |

## Runtime settings

| File | Read by |
|---|---|
| `profile.yml` | `src/cvgen/_cv-content.mjs`: contact identity in the rendered CV. |
| `portals.yml` | `src/scan/scan.mjs`, `src/helpers/verify-portals.mjs`: employers to scan, title and location filters. |
| `cv-drafting.json` | Drafting launchers: provider, models, executable paths (the evaluator borrows them), `max_repairs` (0-3), `max_pages` (1-4). |
| `cv-content-policy.json` | `src/cvgen/_cv-content.mjs`: `required_role_headings`, the roles every CV must include. |
| `evaluation-cli.json` | Optional evaluator overrides (provider, models, concurrency, repairs, timeout). Absent means code defaults. |
| `llm-providers.json` | `src/server/providers.mjs`: provider and model per function (`evaluation`, `companyResearch`, `cv`, `coverLetter`, `intake`), set from the dashboard's Providers page; a valid file wins over the launchers' defaults. |
| `llm-prices.json` | `src/lib/llm-prices.mjs`: USD per million tokens for the Cost page's API-price view. Optional; without it `examples/llm-prices.example.json` is used. A present file replaces the example entirely, an invalid one is an error on the Cost page (never a silent fallback), and a model without an entry shows as unpriced, never zero. Read on every request. |
| `firecrawl.json` | `src/server/intake-fetch.mjs`: `{ "version": 1, "apiKey": "fc-..." }` for URL intake of LinkedIn, Indeed and JavaScript-only postings. `FIRECRAWL_API_KEY` overrides it. Read per fetch, sent only to Firecrawl in a header, never logged or returned; only the posting URL is sent. Without it, URL intake still works for postings the scan resolver can read. |
| `database-import.json` | Legacy import recovery only. |

Choose only models your subscription login can use; evaluation and drafting accept subscription logins
and no API keys.

## Readiness: what each dashboard action needs

| Action | Needs |
|---|---|
| Scan | PostgreSQL up, `portals.yml` |
| Paste a JD | PostgreSQL up |
| Evaluate | PostgreSQL, a CLI login, both compact files in `llm/compacted/`, a cached JD for the job |
| CV or letter | PostgreSQL, a CLI login, an evaluation report, `cv.md` with slot markers, `profile.yml`, `cv-drafting.json`, `cv-content-policy.json`, `cv-compact.md`, the two private style inputs |
| Publish letter | An edited `output/<company>/<role>--<job-id>/cover-letter.md` |

## Where private data lives (the data contract)

Private, gitignored, never committed and never quoted into `src/`, `llm/prompts/`, `web/` or any README:

| Path | What it is | Written by |
|---|---|---|
| `config/*` (except this README, `examples/`) | The files above | you |
| `llm/compacted/` | Compact twins | you |
| `llm/prompts/cvgen/writing-style-guide.txt`, `cover-letter-paragraph-worksheet.txt` | Personal style inputs substituted into drafting prompts | you |
| `data/jds/` | Cached job descriptions, one file per posting; mirrored in `job_descriptions` | scan, pasted-JD intake, `sync-jds --apply` |
| `data/evaluations/` | Reports named `<id>-<company>-<role>-<date>.md`; paths stored in the database | the evaluator (transactional publish) |
| `data/company-info/` | Company research cache with per-section dates | the evaluator |
| `data/interview-prep/`, `data/writing-samples/`, `data/notes/` | Personal documents (placeholders and scaffolds are tracked) | you |
| `data/archive/`, `data/backups/` | Retired material; PostgreSQL dumps | cleanup, `db-infra backup` |
| `data/hiring-cafe-search-cache.json` | Generated discovery cache | scan (never in `--dry-run`) |
| `output/<company>/<role>--<job-id>/` | Generated CV PDFs, editable `cover-letter.md`, published letter PDFs | drafting, publish |
| `logs/` | Run evidence per function, temporary `workers/` folders | every launcher; pruned by `prune-logs` |
| `.env`, `infra/docker/.env` | Database credentials | you |

System layer (tracked): `src/`, `llm/prompts/` (except the two style inputs), `infra/`, `web/`, the folder
READMEs, `config/examples/`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `.github/`.

Rules: system code never edits `config/` or `llm/compacted/`; candidate facts enter prompts only at run
time; a new private path gets an ignore rule and a row above; `data/` is ignored except its tracked
placeholders; `src/test-all.mjs` fails if a private file becomes tracked. Local agent folders
(`.agents/`, `.codex/`, `.aws/`) and `.env.*` variants are ignored; `.env.example` is a public scaffold.
Never put a real key, password or candidate fact in `examples/`.
