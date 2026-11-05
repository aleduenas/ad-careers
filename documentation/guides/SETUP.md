# Setup

Deterministic setup for a fresh machine. No conversational onboarding: the checklist at the end
says exactly which files must exist before each dashboard action works.

## 1. Prerequisites

- Windows 11 (launcher and Docker setup script are Windows-specific; Node/Go code is portable)
- Node.js 24 and npm
- Go 1.25 or newer (`dashboard/go.mod` is the authority)
- Docker Desktop (PostgreSQL runs in Compose)
- Claude Code CLI (`claude`) and/or Codex CLI (`codex`) with a **subscription login**
  (`claude auth login` / `codex login`). API keys are deliberately stripped from worker
  environments; see `src/lib/cli-runtime.mjs`.

## 2. Install

```bash
npm install
npx playwright install chromium     # PDF rendering; also the rendered-page fallback for some scan providers
```

## 3. Database

```bash
node src/helpers/db-infra.mjs init  # creates root .env with a random password; refuses to overwrite it
npm run db:up                       # docker compose up, waits for healthy
npm run db:migrate                  # applies infra/sql/migrations/ in order with checksums
node src/helpers/db-schema.mjs --check
```

Details, statuses, backup/restore and legacy recovery: [database.md](database.md).

## 4. Private configuration

Copy the profile, portals, cv-drafting and cv-content-policy examples from `config/examples/`,
removing `.example` from their filenames. Fill in the role headings and choose models available
to your provider login. `evaluation-cli.example.json` supplies optional evaluator overrides.
Then fill in the private candidate files. All of `config/` except `README.md` and
`examples/` is gitignored.

| File | Purpose | Needed by |
|---|---|---|
| `config/profile.yml` | Contact identity for the rendered CV (`candidate.full_name`, email, phone, linkedin, github) | CV drafting |
| `config/portals.yml` | Which employers/portals to scan, title and location filters | Scan |
| `config/cv.md` | Canonical CV. Headings `## Professional Experience`, `## Projects`, `## Education` with `### Title | Organization | Dates` entries; each experience/project entry carries `<!-- slot: key -->` matching the worksheet keys in `llm/prompts/cvgen/cv-worksheet.md`; education entries carry a `**CV description:**` line | CV drafting |
| `config/profile.md` | Who the candidate is and what they want (narrative, targeting, comp, location, rulings) | Reference; compact twin below |
| `config/cv-drafting.json` | CLI provider, models, executable paths, drafting archive root | CV drafting, evaluation (executable paths) |
| `config/cv-content-policy.json` | `required_role_headings`: roles that every CV must include | CV drafting |
| `config/evaluation-cli.json` | Optional evaluator overrides (models, concurrency, repairs, timeout) | Evaluation |
| `llm/compacted/cv-compact.md` | Token-cheap twin of `config/cv.md` | CV drafting, evaluation |
| `llm/compacted/candidate-targeting.md` | Token-cheap twin of `config/profile.md` (targeting, comp, location, rulings) | Evaluation |
| `llm/prompts/cvgen/writing-style-guide.txt`, `cover-letter-paragraph-worksheet.txt` | Personal writing style and paragraph bank (private) | CV and letter drafting |

Sync rule: a change to `config/cv.md` or `config/profile.md` is made in its compact twin in the
same edit (both headers say so). `config/README.md` has the full file list.

## 5. Build and launch the dashboard

```bash
cd dashboard && go build -o dashboard.exe . && cd ..
dashboard/launch-dashboard.ps1      # or ./dashboard/dashboard.exe --path .
```

## 6. Verify

```bash
node src/test-all.mjs --quick
node src/helpers/verify-portals.mjs
node src/cvgen/draft-cv.mjs --doctor        # confirms subscription logins for both providers
node src/eval/evaluate-jobs.mjs --doctor
```

## Readiness checklist

| Dashboard action | Requires |
|---|---|
| Scan | PostgreSQL up, `config/portals.yml` |
| Paste JD | PostgreSQL up |
| Evaluate | PostgreSQL up, CLI login, `llm/compacted/cv-compact.md`, `llm/compacted/candidate-targeting.md`, a cached JD for the job |
| CV / letter | PostgreSQL up, CLI login, an evaluation report for the job, `config/cv.md` with slot markers, `config/profile.yml`, `config/cv-drafting.json`, `config/cv-content-policy.json`, `llm/compacted/cv-compact.md`, the two private style inputs |
| Publish letter | An edited `output/<company>/<role>/cover-letter.md` |
