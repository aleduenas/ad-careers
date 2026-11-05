# Data contract

Which files are **private candidate material and work product** (gitignored, never written by
system logic except where stated) and which are **system** (code, prompts, documentation,
tracked). The layout itself is defined in [layout.md](layout.md); this page is the
per-folder ownership table the tests enforce (`src/test-all.mjs` checks that the private
files are not tracked).

## Private layer

| Path | What it is | Written by |
|---|---|---|
| `config/profile.yml`, `config/portals.yml`, `config/*.json` | Runtime settings: identity for the rendered CV, portals to scan, drafting/evaluation options, content policy | you |
| `config/cv.md` | Canonical CV with slot markers and education `**CV description:**` lines | you |
| `config/profile.md` | Canonical narrative: who the candidate is, targeting, comp, location, negotiation, evaluation rulings | you |
| `config/cv-guidance.md` | CV presentation guardrails (reference only) | you |
| `llm/compacted/cv-compact.md`, `llm/compacted/candidate-targeting.md` | Token-cheap twins of `config/cv.md` and `config/profile.md`; read by the launchers. Sync rule in both headers | you |
| `llm/prompts/cvgen/writing-style-guide.txt`, `cover-letter-paragraph-worksheet.txt` | Personal style inputs substituted into drafting prompts | you |
| `data/jds/` | Cached job descriptions, one file per posting; content mirrored in `job_descriptions` | scan, pasted-JD intake, `sync-jds --apply` |
| `data/evaluations/` | Evaluation reports, filename `<id>-<company>-<role>-<date>.md`; paths stored in `jobs.report_path` / `evaluations.report_path` | evaluator (transactional publish) |
| `data/company-info/` | Company research cache with per-section freshness dates | evaluator |
| `data/interview-prep/` | Interview preparation documents and story bank (`story-bank.template.md` is tracked as a scaffold) | you |
| `data/writing-samples/` | Style rule versions and past letters being sorted (`README.md` tracked) | you |
| `data/notes/` | Personal notes and unrelated projects | you |
| `data/archive/`, `data/backups/` | Retired material with READMEs; PostgreSQL dumps | cleanup steps, `db-infra backup` |
| `data/hiring-cafe-search-cache.json` | Generated discovery cache | scan (never in `--dry-run`) |
| `output/<company>/<role>--<job-id>/` | Generated CV PDFs, editable `cover-letter.md`, published letter PDFs | drafting, publish |
| `logs/` | Run evidence: `evaluation/<run>/`, `drafting/runs/`, `publishing/`, `dashboard/`, `tests/`, `token-usage/`, `workers/` (temporary) | every launcher; pruned by `prune-logs` |
| `.env`, `infra/docker/.env` | Database credentials | you |

## System layer (tracked)

| Path | What it is |
|---|---|
| `src/` | Backend code and tests |
| `llm/prompts/` (except the two private style inputs) | Versioned prompt contracts for LLM workers |
| `infra/` | Migrations, schema snapshot, Docker setup |
| `dashboard/` | Go TUI source; the built `dashboard.exe` and `dash.lnk` are ignored |
| `config/README.md`, `config/examples/` | Documentation of the private files and starting examples |
| `documentation/` | Index, guides, per-file pages, history |
| `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json` | Rules for AI development sessions |
| `package.json`, `.github/workflows/` | Dependencies and CI |

## PostgreSQL is the operational store

`jobs`, `evaluations`, `job_status_events`, `workflow_claims`, `scan_history`, `job_descriptions`
own IDs, statuses, scores, history and JD text. Files under `data/` are readable caches or
work product; paths stored in the database are relative to the repository root. There is no
writable file tracker and none may be added.

## Rules

1. System logic never edits `config/`, `config/profile.md` or `llm/compacted/`.
2. Candidate facts never appear in system-layer files; they enter prompts only at run time.
3. A private document with a compact twin is changed in both places in the same edit.
4. New private paths get an ignore rule and a row here; new system files get a documentation page.
5. `data/` is ignored by default; only its tracked placeholders, writing-sample README and
   interview story-bank template are allowed. Local agent directories (`.agents/`, `.codex/`,
   `.aws/`) and `.env.*` variants are ignored too; `.env.example` remains a public scaffold.
