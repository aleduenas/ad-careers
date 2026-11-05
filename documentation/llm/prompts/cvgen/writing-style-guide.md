# llm/prompts/cvgen/writing-style-guide.txt

**Kind:** private style input (gitignored; content never quoted in documentation)

**Purpose:** The candidate's writing-style rules for every piece of candidate-facing prose the
drafting workers produce: CV summary, experience bullets, project descriptions and cover
letters. It is a plain-text file maintained by hand; the scripts insert it verbatim.

**Substituted by:** read by `src/cvgen/draft-cv.mjs` and `src/cvgen/draft-cover-letter.mjs`
and inserted as `{{WRITING_STYLE}}` into `cv-worksheet.md` and `cover-letter-worksheet.md`.
Both scripts also copy it into the run folder under `logs/drafting/runs/<run-id>/` as
`writing-style-guide.txt` for audit.

**Placeholders:** none of its own; it fills `{{WRITING_STYLE}}`.

**Expected response:** not applicable.

**Notes:**

- Ignored by git (`.gitignore` names it explicitly). A fresh clone has no copy; the drafting
  scripts fail with a file-not-found error until one is created.
- Not read by the evaluator; evaluation prose is not candidate-facing.
- Observation: nothing validates the style rules after generation; the scripts trust the model
  to apply them, and the dashboard flags every draft as needing visual review.
