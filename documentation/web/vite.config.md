# Vite development and build configuration

**Authority:** [web/vite.config.mjs](../../web/vite.config.mjs).

Configures the Vite React plugin, uses `web/` as the application root, and writes production
assets to ignored `web/dist/`. The development server binds only to `127.0.0.1:5173` and fails
instead of selecting another port. It accepts that exact host and proxies `/api` to
`http://127.0.0.1:4310`; the proxy changes the upstream Host to the backend target and does not
add forwarded headers. Vite file serving is strict and limited to the `web/` root plus the root
`node_modules/` directory required for installed frontend dependencies. The repository path comes
from `src/lib/root.mjs`; the repository root and private directories are not served as Vite file
roots. Vite's built-in deny list remains enabled. `npm run web:dev` starts it.

The build also defines `__BUILD_STAMP__` as the ISO time of the build (`dev` when serving, so no restart
banner appears in development). The page compares it with `build` from `/session` (package 4.3, F16).
