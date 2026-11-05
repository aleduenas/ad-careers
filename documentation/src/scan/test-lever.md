# src/scan/test-lever.mjs

**Authority:** [src/scan/test-lever.mjs](../../../src/scan/test-lever.mjs).

Injects API fixtures into the Lever provider to verify more than 250 jobs, complete list/closing JD sections, duplicate pages and an explicit cap error. No network or persistent writes.

Run: `node src/scan/test-lever.mjs`. Assertions fail with a nonzero exit code. Discovered by `src/test-all.mjs`; database/Chromium prerequisites are described above.

