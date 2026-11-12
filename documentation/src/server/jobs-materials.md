# src/server/jobs-materials.mjs

**Authority:** the source file; artifact identity rules in `documentation/guides/layout.md`
(artifact identity).

Exports `resolveJobMaterials(rows, rootDir)`, returning a `Map` from job ID (decimal string) to
`{cv, letter}` flags that drive the CV and Letter badges in the jobs list. It enumerates
`output/<company>/<role>/` once per call with bounded directory and file counts, skipping
symbolic links and anything outside `output/` (via `jobs-paths.mjs`).

Matching order per job:

1. Exactly one role folder ending in `--<id>` wins. Two or more such folders are ambiguous and
   yield no badges; another job's ID folder is never used.
2. Otherwise legacy folders (no ID suffix) are matched by normalized company slug (corporate
   suffixes stripped, hyphen-insensitive containment), then exact role slug, then token
   similarity at or above 0.75 with no tie.

`resolveJobMaterialDetail(row, rootDir)` returns `{match:'id'|'legacy'|'none', ambiguous, dir, files}`
for one job using the same matching: `dir` is the real matched folder inside `output/` and `files`
holds the preferred file per key (`cv`, `letter`, `brief`) as `{name, kind}`. `pickMaterials(names)`
encodes the preference: `cv-*.pdf` before `cv-*.html`; letter `cover-letter.md`, `.pdf`, `.html`,
`cover-letter-draft.md`; brief `cover-letter-brief*.md`; names are sorted so ties are stable.
`slug` is also exported for the interview-prep matcher. The 2.1 flags API is unchanged.

A folder counts as `cv` when it holds `cv-*.pdf` or `cv-*.html`, and as `letter` for
`cover-letter.md|pdf|html`, `cover-letter-draft.md` or a `cover-letter-brief*.md`. The module
only lists file names; it never opens, moves or writes files.

**Tests:** `node --test src/server/test-jobs-read.mjs` builds synthetic output trees for the
exact-ID, duplicate-ID and legacy fallback cases.
