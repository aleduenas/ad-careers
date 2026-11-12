# Build-time constants

**Authority:** [web/src/env.d.ts](../../../web/src/env.d.ts).

Declares `__BUILD_STAMP__`, a string that `web/vite.config.mjs` replaces at build time with the ISO time of
the build, or `dev` under the Vite dev server. Only `web/src/api.ts` reads it.
