# Customization

Where to change behaviour, and what actually reads each file. Editing a file nothing reads
changes nothing; this page only lists live inputs.

| I want to change… | Edit | Read by |
|---|---|---|
| Which companies are scanned, title/location filters | `config/portals.yml` (start from `config/examples/portals.example.yml`) | `src/scan/scan.mjs`, `src/helpers/verify-portals.mjs` |
| The scoring rubric (dimensions, weights, 1–5 anchors) | `llm/prompts/eval/scoring.md` only; weights must sum to 100 | parsed at load by `src/eval/_evaluation-cli.mjs`; parity test in `src/eval/test-evaluation-cli.mjs`; rationale in `scoring-rubric.md` |
| What the evaluator knows about the candidate (targets, comp, location, education framing, experience-credit and scoring rulings) | `llm/compacted/candidate-targeting.md`, and the same change in `config/profile.md` | `src/eval/evaluate-jobs.mjs` (`{{TARGETING}}`) |
| Candidate facts the evaluator and CV writer see | `llm/compacted/cv-compact.md`, and the same change in `config/cv.md` | both launchers (`{{CANDIDATE_FACTS}}`, `{{CANDIDATE_CV}}`) |
| What appears on the rendered CV (roles, bullets source, education lines, contact row) | `config/cv.md` (slot markers, `**CV description:**` lines), `config/profile.yml` (`candidate.*`), `config/cv-content-policy.json` (`required_role_headings`) | `src/cvgen/_cv-content.mjs` |
| CV look and fonts | `src/cvgen/templates/cv-structured.html` and `src/cvgen/templates/fonts/` | `renderHTML`, `generate-pdf.mjs` |
| The CV/letter worksheet the model fills, validation-repair instructions and their rules | `llm/prompts/cvgen/cv-worksheet.md`, `cv-repair.md`, `cv-repair-json.md`, `cover-letter-worksheet.md`. Renaming a slot key also means updating the `<!-- slot: -->` marker in `config/cv.md` and the validator's expectations in `src/cvgen/_cv-worksheet.mjs` | `src/cvgen/draft-cv.mjs`, `draft-cover-letter.mjs` |
| Writing style and letter paragraph bank | `llm/prompts/cvgen/writing-style-guide.txt`, `cover-letter-paragraph-worksheet.txt` (private) | both drafting launchers |
| Evaluation prompts (gate, research, worksheet, repair) | `llm/prompts/eval/*.md`; keep placeholders and the JSON worksheet keys in step with `src/eval/_evaluation-worksheet.mjs` | `src/eval/` |
| Provider, models, timeouts | `config/cv-drafting.json` (drafting; executable paths shared), `config/evaluation-cli.json` (evaluation overrides) | `src/lib/cli-runtime.mjs`, `src/eval/evaluate-jobs.mjs` |
| Location eligibility rules | `src/scan/location-gate-core.mjs` (scan-time) and `llm/prompts/eval/gate.md` (evaluation-time) | scan, evaluator |
| Application statuses | A new migration under `infra/sql/migrations/` plus dashboard status handling; see `database.md` | PostgreSQL, dashboard |
| Retention of logs and backups | `src/helpers/prune-logs.mjs` policy table | `prune-logs` |
| Rules for AI development sessions | `AGENTS.md`, `.claude/settings.json` | Claude Code / Codex sessions |

This table covers the main customization points. `infra/sql/schema.sql` is generated;
`documentation/index.md` is maintained by hand. Historical decisions live under
`documentation/history/`, and retired private material under `data/archive/`.
