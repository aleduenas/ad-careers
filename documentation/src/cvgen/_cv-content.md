# src/cvgen/_cv-content.mjs

**Authority:** [src/cvgen/_cv-content.mjs](../../../src/cvgen/_cv-content.mjs).

Builds the canonical CV catalog and renders HTML from an adapted worksheet answer.

## Inputs

`loadCatalog(root)` reads `config/cv.md`, `config/profile.yml` and `config/cv-content-policy.json`. It parses experience, projects and education, slot markers, education descriptions and repository badges; missing required role headings fail.

## Outputs and behavior

`renderHTML(answer, catalog, template)` returns escaped HTML with `{{TITLE}}` and `{{CONTENT}}` replaced. It uses canonical employment order and identity, omits excluded entries and empty sections, and validates contact URL protocols. The contact row lists phone, email, LinkedIn, GitHub and the optional `candidate.spoken_languages` text, skipping empty fields. No files are written.

## Dependencies and callers

Imports Node filesystem/path and `js-yaml`. Used by `draft-cv.mjs`, `_cv-drafting.mjs`, `_cv-worksheet.mjs` consumers and the CV tests. Worksheet adaptation is in `_cv-worksheet.mjs`; this module does not validate model factuality.

