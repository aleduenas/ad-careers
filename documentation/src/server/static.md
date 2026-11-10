# Production static asset handler

**Authority:** `src/server/static.mjs`.

Serves only regular files below the configured production `web/dist` directory. `/` serves the
built `index.html` (hash routes remain in the fragment and reload at `/`); missing paths,
malformed encodings, traversal, and resolved paths outside the canonical build directory are
rejected. Only GET and HEAD are allowed. `/api` and encoded API paths are reserved for
the JSON API and never falls through to HTML. HTML and assets receive a restrictive same-origin
Content Security Policy, with API JSON policy retained by `app.mjs`. The module is injected into
the Fastify not-found handler by `start.mjs`; it imports the canonical repository root helper.
