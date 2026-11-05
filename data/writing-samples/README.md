# Writing Samples

Private folder (gitignored except this README). It holds every writing-style rule set,
cover-letter process document and sample letter in the repository, consolidated on
2026-09-19 for sorting. `MANIFEST.md` lists each file, where it came from, and whether the
drafting launchers load it.

Layout:

| Folder | Contents |
|---|---|
| `style/` | Writing style guides and rule sets. `writing-style-guide.txt` is the one the launchers load |
| `cover-letter-process/` | Cover-letter instructions, assembly notes and the paragraph worksheet the launchers load |
| `cover-letters/` | Past letters kept as reference samples |

Runtime behaviour: `scripts/draft-cv.mjs` and `scripts/draft-cover-letter.mjs` substitute
`style/writing-style-guide.txt` as `{{WRITING_STYLE}}` and
`cover-letter-process/cover-letter-paragraph-worksheet.txt` as `{{LETTER_SAMPLES}}`. Editing
any other file here changes nothing at runtime until it is promoted to one of those two
paths.
