# src/cvgen/test-pdf-render.mjs

**Authority:** [src/cvgen/test-pdf-render.mjs](../../../src/cvgen/test-pdf-render.mjs).

Real Chromium integration: renders a synthetic fixture with the live template, requires DM Sans and Space Grotesk to load, and verifies a nonempty one-page PDF. Writes private evidence under logs/tests/pdf-render. Skips unless --render is supplied; no model calls.

Run: `node src/cvgen/test-pdf-render.mjs --render`. Assertions fail with a nonzero exit code. Discovered by `src/test-all.mjs`; database/Chromium prerequisites are described above.

