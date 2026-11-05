# llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt

**Kind:** private style input (gitignored; content never quoted in documentation)

**Purpose:** The candidate's reference cover-letter paragraphs: the voice and wording the
worker is told to preserve as far as possible, changing them only to connect CV-supported
facts to the JD and to add ATS terms. It is a hand-maintained plain-text file.

**Substituted by:** read only by `src/cvgen/draft-cover-letter.mjs`; inserted as
`{{COVER_LETTER_SAMPLES}}` into `cover-letter-worksheet.md`. Copied into the run folder as
`cover-letter-samples.md`. The CV worker never receives it.

**Placeholders:** none of its own; it fills `{{COVER_LETTER_SAMPLES}}`.

**Expected response:** not applicable.

**Notes:**

- Ignored by git; a fresh clone has no copy and the letter scripts fail until one exists.
- Observation: the name says worksheet but the file is reference prose, not a fill-in template.
