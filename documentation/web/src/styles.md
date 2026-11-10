# `web/src/styles.css`

**Authority:** the frozen DOM and theme contract in `documentation/dashboard-migration/design/FRONTEND_STYLE_CONTRACT.md`; this page documents the stylesheet implementation.

Provides the browser dashboard's global typography, spacing, green light/dark palettes, navigation, status cards, notices, controls, focus indicators, and Radix/native dialog presentation. The frontend imports this file from its main entry. Theme tokens switch only through `document.documentElement.dataset.theme` values `light` and `dark`.

The wide shell uses a 221px sidebar and a fluid main column. At widths below 700px, the sidebar becomes a top header and navigation scrolls in its own region; the document itself is not given horizontal overflow. Intermediate widths use a 200px sidebar and two-column status cards. Reduced-motion preferences suppress animations and transitions. Fonts are system-local; the stylesheet requests no external assets.
The mobile navigation has 7px inline scrollport padding so keyboard scrolling can keep the full focus outline visible at either end.

The stylesheet covers these existing class groups: `.app-shell`, navigation and brand, top actions, page heading, connection states, welcome/capability cards, status grid, notices, footer and dialog classes. `.dialog` resets the native dialog margin so its fixed viewport-centered placement is stable, while leaving its browser display mode intact. The `dialog.dialog:not([open])` rule hides the closed native dialog.

**Limits:** CSS does not implement modal focus management, Escape dismissal, inert behavior, theme persistence, routing, or API state. Those remain frontend/controller responsibilities. Browser visual verification and measured overflow results belong in `documentation/dashboard-migration/reviews/1.2-style-handoff.md` and the frontend's review evidence.
