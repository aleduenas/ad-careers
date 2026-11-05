# src/cvgen/templates/cv-structured.html

**Authority:** [src/cvgen/templates/cv-structured.html](../../../../src/cvgen/templates/cv-structured.html).

Provides the active CV print layout.

## Inputs

The drafting launcher reads this template and passes it to `_cv-content.mjs::renderHTML`. Only `{{TITLE}}` and `{{CONTENT}}` are substituted.

## Outputs and behavior

HTML/CSS defines the document sections, typography and print layout. The PDF renderer consumes the filled HTML; this file performs no writes.

## Dependencies and callers

Uses local WOFF2 files under `fonts/`. Used by `draft-cv.mjs` and the catalog/renderer tests. Keep both placeholders intact.

