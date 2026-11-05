# src/cvgen/generate-pdf.mjs

**Authority:** [src/cvgen/generate-pdf.mjs](../../../src/cvgen/generate-pdf.mjs).

HTML-to-PDF renderer.

## Run and callers

Run `node src/cvgen/generate-pdf.mjs input.html output.pdf [--format=letter|a4]`. A4 is the default; drafting passes letter. `generatePDF(args)` is also exported for the integration test.

## Inputs

Reads the input HTML and WOFF2 assets below `src/cvgen/templates/fonts/`, resolving the repository through `src/lib/root.mjs`. Embeds font bytes as data URLs so Chromium can load them from injected HTML. Preserves a base URL for other relative resources; normalizes body punctuation for ATS text extraction.

## Behavior and outputs

Writes the requested PDF, creating its parent directory. Waits for font loading and fails on font errors; logs loaded families, approximate page count and file size. Returns those values plus font statuses. Uses Playwright, Node filesystem/path/URL and the root helper. Called by both CV generation and letter publishing. `test-pdf-render.mjs --render` verifies real font loading. Page size and 0.6-inch margins are renderer policy; no automatic page-count limit.
