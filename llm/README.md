# llm/

Everything an LLM *worker* reads when doing the project's work (evaluating a job, writing a
CV or letter). Nothing here is read by AI *development* sessions; those read `AGENTS.md`.

| Folder | Contents | Substituted by |
|---|---|---|
| `prompts/eval/` | gate, company-research, market-research, scoring (THE rubric), evaluate, repair; `INDEX.md` lists every input | `src/eval/evaluate-jobs.mjs`, `src/eval/_evaluation-cli.mjs` |
| `prompts/cvgen/` | CV worksheet, CV validation-repair prompt, cover-letter worksheet, writing style guide, paragraph worksheet | `src/cvgen/draft-cv.mjs`, `src/cvgen/draft-cover-letter.mjs` |
| `prompts/runtime/` | provider system prompts (`no-tools`, `research`) | `src/lib/cli-runtime.mjs` process runner |
| `compacted/` | (private) token-cheap twins of `config/` documents: `cv-compact.md`, `candidate-targeting.md` | both launchers |

Launcher and prompt are a pair: a placeholder renamed in one must be renamed in the other.
