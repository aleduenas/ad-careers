# Repository layout

Adopted 2026-09-19 (audit Session 02, option B). This is the structure we adhere to. When
adding a file, find its row here; if no row fits, add one to this document first.

## Tree

```
career-ops/
├── README.md                     front page: what it is, how to launch, link to documentation/
├── AGENTS.md, CLAUDE.md          instructions for AI *development* sessions (tool convention: root)
├── .claude/                      Claude Code settings for development sessions
├── package.json
│
├── src/                          backend the dashboard shells out to
│   ├── lib/                      modules imported by more than one function; never run directly
│   ├── helpers/                  runnable admin/maintenance commands (db-*, move-status, sync-jds, verify-*, prune-*)
│   ├── cvgen/                    CV and cover-letter generation + PDF rendering; templates/ for HTML + fonts
│   ├── eval/                     job evaluation
│   ├── scan/                     portal scanning, pasted-JD intake, location gate; providers/
│   ├── analytics/                pattern and follow-up analysis
│   └── test-all.mjs              discovers test-*.mjs in every function folder
│
├── infra/
│   ├── sql/                      migrations/ (immutable, ordered) and schema.sql (generated snapshot)
│   └── docker/                   compose.yml, .env.example, setup-windows.ps1
│
├── dashboard/                    Go TUI and the deployed dashboard.exe
│
├── llm/                          everything an LLM *worker* (evaluator, CV writer) reads
│   ├── prompts/cvgen/            worksheets, writing style guide, paragraph worksheet
│   ├── prompts/eval/             gate, research, scoring (THE rubric), evaluate, repair
│   ├── prompts/runtime/          provider system prompts
│   └── compacted/                (private) token-cheap versions of config documents
│
├── config/                       (private except examples/) candidate documents and runtime settings
├── data/                         (private) work product and caches: jds/, evaluations/, company-info/,
│                                 interview-prep/, writing-samples/, notes/, archive/, backups/
├── output/<company>/<role>--<job-id>/      (private) generated CVs and letters
├── logs/                         (private) run evidence by function (dashboard/, evaluation/, drafting/, publishing/, tests/, token-usage/)
└── documentation/                index, one page per source file, guides/
```

## Rules

1. **Functions own their code and tests.** A script goes in the `src/<function>/` it serves; its tests sit beside it as `test-*.mjs`. `src/lib/` only holds modules imported by two or more functions. `src/helpers/` only holds commands a person runs by hand.
2. **Prompts live in `llm/`, never in `src/`.** A launcher references its prompt by path. Launcher and prompt are a pair: the documentation page of each names the other.
3. **Two sizes of every candidate document.** The full version lives in `config/`; if a worker needs a token-cheap version it lives in `llm/compacted/` with the same base name plus `-compact`, and both carry a sync note. Today: `config/cv.md ↔ llm/compacted/cv-compact.md`, `config/profile.md ↔ llm/compacted/candidate-targeting.md`.
4. **Candidate material never enters `src/`, `llm/prompts/`, `dashboard/` or `documentation/`.** Facts come from `config/` and `llm/compacted/` at run time.
5. **Root resolution goes through `src/lib/root.mjs`.** No script computes the repository root from its own depth.
6. **PostgreSQL is the only writable store for jobs, statuses and evaluations.** Folders under `data/` are readable caches or personal work product; paths stored in the database are relative to the repository root.
7. **Every source file has a page** under `documentation/` mirroring the source path, with its final extension replaced by `.md` (for example `src/scan/scan.mjs` becomes `documentation/src/scan/scan.md`), describing purpose, inputs, outputs, what imports it and what it imports. Adding a file means adding its page; `src/test-all.mjs` checks for missing pages.
8. **Dev-session and worker instructions never mix.** `AGENTS.md`/`.claude/` describe how to work on the repo and contain no career context; `llm/` contains no repository-maintenance instructions.
9. **Migrations are immutable.** Schema changes are new numbered files in `infra/sql/migrations/`; `schema.sql` is regenerated, never hand-edited.
10. **After any change under `dashboard/`, rebuild the real binary:** `go build -o dashboard.exe .` from `dashboard/`.

## Artifact identity

New job-based drafts use `output/<company>/<role>--<job-id>/`. The dashboard looks up
permanent IDs before legacy company/title folders and never uses another ID-specific folder
as a fuzzy fallback. Historical output folders are preserved. Standalone explicit `--out`
remains caller-selected; per-folder locks protect concurrent writes.

## What moved where (2026-09-19)

| Before | After |
|---|---|
| `scripts/*.mjs` | `src/lib/`, `src/helpers/`, `src/cvgen/`, `src/eval/`, `src/scan/`, `src/analytics/` by function |
| `scripts/providers/` | `src/scan/providers/` |
| `templates/cv-structured.html`, `fonts/` | `src/cvgen/templates/` |
| `database/migrations/`, `database/schema.sql` | `infra/sql/` |
| `database/*.mjs`, `scripts/db-*.mjs` | `src/helpers/` |
| `infra/compose.yml`, `.env.example`, `setup-windows.ps1` | `infra/docker/` |
| `prompts/cv/`, `prompts/cover-letter/`, writing style guide, paragraph worksheet | `llm/prompts/cvgen/` |
| `prompts/evaluation/` | `llm/prompts/eval/` |
| `prompts/runtime/` | `llm/prompts/runtime/` |
| `data/cv/cv-compact.md` | `llm/compacted/cv-compact.md` |
| `config/evaluation-candidate.md` | `llm/compacted/candidate-targeting.md` |
| `docs/candidate/profile.md`, `cv-guidance.md` | `config/profile.md`, `config/cv-guidance.md` |
| `templates/*.example.yml` | `config/examples/` |
| `jds/`, `reports/`, `company-info/`, `interview-prep/`, `writing-samples/`, `notes/` | `data/jds/`, `data/evaluations/`, `data/company-info/`, `data/interview-prep/`, `data/writing-samples/`, `data/notes/` (completed; stored paths rewritten by migration 005) |
| `docs/` | `documentation/` |
