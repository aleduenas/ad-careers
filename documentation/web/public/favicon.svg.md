# `web/public/favicon.svg`

Static 32 by 32 SVG favicon: a dark green rounded square with two linked rings in the accent green,
matching the sidebar brand mark. No scripts, text or external references. Vite copies `web/public`
unchanged into `web/dist`, and the production static handler serves it as `image/svg+xml`
under the existing `img-src 'self'` policy. Referenced from `web/index.html`.
