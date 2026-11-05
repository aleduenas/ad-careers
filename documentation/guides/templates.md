# Templates and examples

| File | Used by | Purpose |
|---|---|---|
| `src/cvgen/templates/cv-structured.html` | `src/cvgen/_cv-content.mjs` (`renderHTML`), `src/cvgen/generate-pdf.mjs` | The live CV template: `{{TITLE}}` and `{{CONTENT}}` are filled from the catalog and the validated worksheet answer; fonts resolved from `src/cvgen/templates/fonts/` |
| `src/cvgen/templates/fonts/*.woff2` | the structured template | Self-hosted fonts (Space Grotesk headings, DM Sans body) |
| `config/examples/profile.example.yml` | you | Starting point for `config/profile.yml` |
| `config/examples/portals.example.yml` | you | Starting point for `config/portals.yml` |
| `data/interview-prep/story-bank.template.md` | you | Scaffold for a private story bank |

Change colours, spacing or section order in `cv-structured.html`; keep the two placeholders.
Per-file pages: `documentation/src/cvgen/templates/`.
