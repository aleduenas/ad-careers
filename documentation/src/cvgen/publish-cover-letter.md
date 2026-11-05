# src/cvgen/publish-cover-letter.mjs

**Kind:** launcher
**Purpose:** Renders a reviewed `output/<company>/<role>--<job-id>/cover-letter.md` to `cover-letter.pdf` beside it. It converts the Markdown paragraphs into a minimal HTML page (salutation to sign-off only, no header block) and delegates rendering to `src/cvgen/generate-pdf.mjs`, keeping a copy of the source, HTML and render log under `logs/publishing/`.

## Run
`node src/cvgen/publish-cover-letter.mjs output/<company>/<role>--<job-id>/cover-letter.md`
- The single argument must be a file named `cover-letter.md` (case-insensitive) located below `output/`; anything else is rejected. No other flags.

## Reads
- the `cover-letter.md` given on the command line (must be non-empty)

## Writes
- `logs/publishing/<timestamp>-<uuid>/`: `cover-letter.md` (copy), `cover-letter.html`, `cover-letter.pdf` (staged), `render.log`
- `output/<company>/<role>--<job-id>/cover-letter.pdf` (copied from the staged PDF after a successful render)
- no PostgreSQL access

## Imports
- `src/lib/cli-runtime.mjs` (`childOf`)
- `src/lib/root.mjs`
- spawns `src/cvgen/generate-pdf.mjs <html> <pdf> --format=letter`

## Used by
- `dashboard/main.go` (the viewer's publish-PDF action runs it with the absolute path of the open `cover-letter.md` and reports `cover-letter.pdf` next to it)

## Counterpart prompt(s)
- none

## Notes
- Paragraphs are split on blank lines; single newlines inside a paragraph become `<br>`; all text is HTML-escaped. The page uses `@page { size: letter; margin: .75in }`, Arial 11pt; no name, contact block, date or "Re:" line is added, matching the cover-letter PDF rule.
- No CLI worker or model call; purely local rendering. The render is spawned with `windowsHide`, so no console window appears when it runs in the background.
- Prints `{status: 'published', pdf, run_directory}` on success; a failed render leaves `render.log` in the run folder and throws.
- The HTML declares a .75in CSS page margin; the shared renderer also supplies a .6in PDF option. Chromium resolves these page settings; they are not two additive body margins. The synthetic publication fixture is visually checked in the completion report.
