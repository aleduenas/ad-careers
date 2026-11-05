# llm/compacted/

**Kind:** private candidate documents, token-cheap twins of files in `config/` (gitignored
folder; contents never quoted in documentation)

**Purpose:** The versions of the candidate documents that LLM workers actually receive. Each is a
hand-compressed twin of a full document in `config/`, carrying the same facts with less text so
the isolated CLI workers spend fewer context tokens. Nothing here is a source of truth on its
own; the full documents are.

**The two files**

| File | Full twin | Inserted as | Read by |
|---|---|---|---|
| `cv-compact.md` | `config/cv.md` | `{{CANDIDATE_FACTS}}` in `llm/prompts/eval/evaluate.md`; `{{CANDIDATE_CV}}` in both cvgen worksheets | `src/eval/evaluate-jobs.mjs`, `src/cvgen/draft-cv.mjs`, `src/cvgen/draft-cover-letter.mjs` |
| `candidate-targeting.md` | `config/profile.md` | `{{TARGETING}}` in `llm/prompts/eval/evaluate.md` | `src/eval/evaluate-jobs.mjs` |

The folder also holds a short `README.md`.

**Sync rule (layout rule 3):** a change to facts in the full document is made in the compact twin
in the same edit, and vice versa; both files carry a sync note with the last-synced date.
Targeting, compensation, location, education framing, experience credit and scoring rulings
must agree between `config/profile.md` and `candidate-targeting.md`; CV facts must agree
between `config/cv.md` and `cv-compact.md`. No script checks this; it is a manual discipline.

**How the evaluator treats them:** `evaluate-jobs.mjs` reads both files at run creation into
`state.sources`, archives them under `logs/evaluation/<run-id>/prompt-sources/`, and refuses
to execute or resume a run if either file changed since (`Inputs changed; start a new run`).
A missing file is a hard error (`Required input missing`).

**Notes:**

- The dashboard never reads this folder. The PDF renderer (`src/cvgen/_cv-content.mjs`) reads
  `config/cv.md` and `config/profile.yml`, not the compact CV; the model sees the compact CV,
  the rendered document takes titles, employers and dates from the full one.
- Private README and sync metadata now use current config/llm paths. The maintenance pass changed only paths and sync instructions, not candidate facts. Factual synchronization remains a manual discipline.
