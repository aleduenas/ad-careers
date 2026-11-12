# `web/index.html`

Authority: this document is the Vite HTML entry point for the browser dashboard. It provides the
viewport, title, root mount element and maintained TypeScript React entry module. All visible
application behavior lives in `web/src/`; no inline application script or external asset is loaded.

The page declares `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`. The icon is
`web/public/favicon.svg`, copied into `web/dist` by the build and served by the static handler, so
browsers no longer request `/favicon.ico` and log a 404.
