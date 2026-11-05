# Prompts (`llm/`)

`llm/prompts/` holds every static instruction sent to an isolated LLM worker; `llm/compacted/`
holds the private, token-cheap candidate inputs those prompts receive. Nothing under `llm/` is
read by AI development sessions (those read `AGENTS.md`), and nothing under `llm/prompts/`
contains candidate facts except the two private style inputs, which are gitignored.

| Folder | Contents | Substituted by |
|---|---|---|
| `prompts/eval/` | `gate.md`, `company-research.md`, `market-research.md`, `scoring.md` (the rubric authority), `evaluate.md`, `repair.md`; `INDEX.md` lists every placeholder and its source | `src/eval/evaluate-jobs.mjs`, `src/eval/_evaluation-cli.mjs` via `renderPrompt` |
| `prompts/cvgen/` | `cv-worksheet.md`, `cv-repair.md`, `cv-repair-json.md`, `cover-letter-worksheet.md`, plus the private `writing-style-guide.txt` and `cover-letter-paragraph-worksheet.txt` | `src/cvgen/draft-cv.mjs`, `src/cvgen/draft-cover-letter.mjs` |
| `prompts/runtime/` | `no-tools.md`, `research.md`: provider system prompts | `src/lib/cli-runtime.mjs` (`cliSpec`) |
| `compacted/` | `cv-compact.md`, `candidate-targeting.md` (twins of `config/cv.md`, `config/profile.md`) | both launchers |

## Contract

- Launchers supply only named `{{UPPERCASE_PLACEHOLDERS}}` and reject any unresolved one.
- Each worker's JSON worksheet is literal text in its prompt; the launcher validates that the
  response preserves the keys and order (`sameShape`, `validateAnswer`) rather than defining the
  shape in code. The CV worksheet validator restores key order and drops stray keys itself
  (`normalizeAnswer`) and reports only missing keys. Renaming a key means changing the prompt, the validator/decoder and the pages
  of both.
- Evaluation runs snapshot every prompt source they used under
  `logs/evaluation/<run>/prompt-sources/`; drafting runs copy the worksheet, repair prompt and
  style guide into `logs/drafting/runs/<run>/`. When validation invokes the repair, the rendered
  repair context and response are saved there too. Those copies are evidence, not sources.

Per-file pages: `documentation/llm/`.
