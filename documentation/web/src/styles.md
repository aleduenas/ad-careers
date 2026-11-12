# `web/src/styles.css`

**Authority:** the frozen DOM and theme contract in `documentation/dashboard-migration/design/FRONTEND_STYLE_CONTRACT.md`; this page documents the stylesheet implementation.

Provides the browser dashboard's global typography, spacing, green light/dark palettes, navigation, status cards, notices, controls, focus indicators, and Radix/native dialog presentation. The frontend imports this file from its main entry. Theme tokens switch only through `document.documentElement.dataset.theme` values `light` and `dark`.

The wide shell uses a 221px sidebar and a fluid main column. At widths below 700px, the sidebar becomes a top header and navigation scrolls in its own region; the document itself is not given horizontal overflow. Intermediate widths use a 200px sidebar and two-column status cards. Reduced-motion preferences suppress animations and transitions. Fonts are system-local; the stylesheet requests no external assets.
The mobile navigation has 7px inline scrollport padding so keyboard scrolling can keep the full focus outline visible at either end.

The stylesheet covers these existing class groups: `.app-shell`, navigation and brand, top actions, page heading, connection states, welcome/capability cards, status grid, notices, footer and dialog classes. `.dialog` resets the native dialog margin so its fixed viewport-centered placement is stable, while leaving its browser display mode intact. The `dialog.dialog:not([open])` rule hides the closed native dialog.

**Limits:** CSS does not implement modal focus management, Escape dismissal, inert behavior, theme persistence, routing, or API state. Those remain frontend/controller responsibilities. Browser visual verification and measured overflow results belong in `documentation/dashboard-migration/reviews/1.2-style-handoff.md` and the frontend's review evidence.

**Package 2.1 additions:** classes for the Overview metric cards and panels, the Jobs toolbar and
controls, grouped job tables, status and material badges, the pagination bar, empty states and the
spinner. The wide jobs table has a minimum width and scrolls inside `.table-scroll`, a focusable
region; `.job-groups` and `.overview-content` use a single `minmax(0, 1fr)` column and
`.job-group` has `min-width: 0`, so the table never widens the page. Runtime checks at 390, 1024
and 1440 px in both themes found no page-level horizontal scroll
(`documentation/dashboard-migration/reviews/2.1/frontend/`).

**Package 2.2 additions:** `.workspace` (single `minmax(0, 1fr)` column), header and facts grid,
`.pane-tabs` and `.pane-grid`, `.doc-pane` and `.doc-text` (`white-space: pre-wrap`,
`overflow-wrap: anywhere`, scrolling at 70vh so long text never widens the page), history tables
inside `.table-scroll`, `.file-list`, `.missing-copy`, and `.back-link`. At 1024 px and wider the
panes are two columns and the tablist is hidden; below that the tablist shows and the inactive
pane (`data-active="false"`) is hidden. `.results-region.is-busy` dims the list while a page loads,
and `.job-name a` makes the company and role the row link. The favicon is `web/public/favicon.svg`,
declared in `web/index.html`.

**Gate delta:** `.table-scroll` has an edge-shadow background (CSS scroll-shadow technique: fades
and shadows at whichever sides have more content). `.scroll-hint` is shown only below 700 px. Below
700 px `.history-table` drops its minimum width and tightens cell padding so the history tables fit
without clipping the Score column.

**Package 3.2 additions:** `.edit-card`, `.edit-grid`, `.edit-field`, `.edit-actions`, `.edit-pair`,
`.edit-fieldset` for the status and details editors; `.field-error` and `.success-copy` for inline
validation and confirmation; `.doc-edit` and `.jd-editor` for the JD textarea (monospace, resizable,
capped at 70vh); `.conflict-text` for the stored text shown after a JD conflict. The two edit cards
share a row at 1024 px and above. Below 700 px history table headers do not wrap and cells break
only at word boundaries so narrow columns stay readable.

**Package 3.3 additions:** `.discover-grid` (one column, two columns from 1024 px), `.discover-card`,
`.paste-step`, `.notice-ok` for preview and success messages, `.run-state` for the live scan state,
`.log-tail` (monospace, capped height, scrolls inside itself), `.scan-report` and `.report-summary`
for the last summary. All reuse the 3.2 edit-card, field-error and file-list classes.

**Package 3.7 additions:** `.providers-page`, `.provider-row` with a three-column field grid (one
column below 700 px), `.source-badge`, `.readiness-row` and `.readiness-badge` with ready, not
logged in, unavailable and unknown colours drawn from the existing tokens, and `.readiness-help`
for the fixed login guidance.

**Package 3.4 additions:** `.action-bar`, `.action-buttons` and `.action-item` with `.action-reason`
(visible reason text under a disabled button), `.run-cards`, `.run-card`, `.run-card-head` and
`.run-badge` with queued, running, completed, failed and interrupted colours from existing tokens, and
`.action-dialog` with `.action-functions`, `.action-function` and `.action-override` for the confirm
dialog. Buttons stack on narrow screens and the dialog fits inside a 390 px viewport.

**Package 3.6 additions:** `.tasks-page`, `.tasks-table` (scrolls inside `.table-scroll`), `.task-toggle`,
`.tui-badge` for legacy rows, `.run-detail-row` and `.run-detail` for the expanded row, `.log-follow`
and `.log-follow-head` for the log and its Pause button, and `.nav-count`, the active-run badge in the
navigation (placed after the label on the narrow strip).

**Package 3.5 additions:** `.letter-section` (ruled off under the materials list), `.letter-editor` (reuses
`.jd-editor` and `.doc-edit`) and `.letter-pdf` for the "Cover letter PDF (draft)" line.

**Package 4.1 additions:** `.search-hint` (with a `kbd` style) for the "Press / to search" hint under the Jobs search box.

**Package 4.1 polish additions:** `.in-page-link`, `.chevron-button`, `.task-action`, `.run-error`, `.run-code`,
`.task-extra` (folded detail lines, hidden above 1100 px) and `.col-minor` (columns hidden at or below 1100 px). The `.job-name .task-extra` selector is needed because `.job-name span` sets `display: block`.
fixed column widths for `.jobs-table`, and 32 px targets for `.file-list a` and `.back-link`.

**Package 4.3 additions:** `.search-hint` is removed. New: `.overview-link` (score bucket and week rows),
`.status-chips` and `.status-chip` (selected state via `aria-pressed`), `.active-filter`, `.materials-strip`,
the `.report-prose` family (`.rp-h1` to `.rp-h4`, `.report-table-scroll`, tables, code and quotes for both
themes) and a compact `.action-bar` grid.

**F10 additions:** `.action-readiness` and `.run-last-lines`.

**F11 additions:** `.ws`, `.ws-bar`, `.ws-bar-main`, `.ws-bar-bare`, `.ws-facts`, `.ws-materials`, `.ws-chrome`,
`.ws-body`, `.ws-center`, `.ws-split`, `.ws-divider`, `.ws-rail` and `.ws-rail-button`, `.ws-panel` (with
`-head`, `-body`, `-close`), `.ws-section`, `.ws-plain`, and `.is-workspace` rules that slim the left navigation
and make the page fill the viewport from 1024 px. Removed: `.materials-strip`, `.workspace-header`,
`.workspace-facts`, `.workspace-role` and `.pane-grid`. Workspace panes and slide-out edit cards are borderless.

**F12 to F14 additions:** `--gutter` and `--content-max` on `:root`; `.ws-meta` (second bar row); `.jobs-add` and `.jobs-add-toggle`; `.error-details`.

**F15 and F16 additions:** `.build-banner` (fixed across the top, `--banner-h` 44/52/84 px by width) with
`.app-shell.has-banner` offsets for the sidebar and workspace height; `.report-empty`.

**F17 and F18 additions:** `--page` and `--line` retuned in both themes, `--muted` darkened in light; pane surfaces (`.ws .doc-pane` with margins, border and radius), a transparent divider with a drawn line, `.jobs-controls` as paper; `.nav-dot`, `.service-page`, `.service-facts`, `.service-table`. Removed: `.connection-pill`. `.error-details > span` is block.

**F22 to F24 additions:** `.report-fields` grid; report tables span the pane, header cells never wrap, the short middle columns have a minimum width and the last column takes the rest (`.report-table-scroll` still scrolls narrow screens); `.ws .report-prose` has no max width, only paragraphs, lists and quotes keep 75ch. Report and JD panes are flat paper (no top or bottom padding or margin, no border, radius or shadow), with side padding only and the gutter margin at the sides.

**F30 additions:** `.ws .doc-pane > h3` is the pane title strip: full pane width (negative side margins equal to the pane padding), `--paper-soft` background, 1 px bottom border, flush with the pane top, `position: sticky; top: 0`. The element after it (the Stored line or the report) gets a 16 px top margin. The structure in `App.tsx` is unchanged.

**F31 to F33 additions:** `.quick-moves`, `.quick-move` (next, reject, confirming), `.ws-status`, `.move-cell`, the ninth table column width, `.jobs-toolbar` and `.jobs-toolbar-row`, `.jobs-title`, `.compact-control`, `.jobs-add-button`, `.ws-panel-solo`, and a tighter top padding on the Jobs page. The old `.jobs-add` section styles are unused.

**F34 additions:** `.action-pair` and `.action-with-model` (the small companion button).

**Package 4.6 additions:** `.url-row` (flex row: the link input grows, the Fetch button keeps its width) and `.url-row input`.

**F35 additions:** `.quick-discard` (the inline discard reason control that replaces the pair in place, compact `edit-fieldset`) and a 216 px minimum width on `.move-cell` so the control is not clipped.

**F36 and F37 additions:** `.ws-material-button` (compact button in the header materials row); `.report-prose table`, `th` and `td` get minimum widths, and first-column cells use `overflow-wrap: normal; word-break: normal; hyphens: none`.

`.ws-material-reason`: the quiet line that states why a header Draft button is disabled.

**Package 4.7 additions:** `.cost-page`, `.cost-bar-controls`, `.cost-toggle`, `.cost-cards`, `.cost-card`, `.cost-section`, `.cost-table` (`.num` right-aligned columns), `.cost-days` (flex bars, `--bar` height per slot, `--days` minimum width), `.cost-bar-slot`, `.cost-bar`, `.cost-bar-value` (hover and focus label), `.cost-day-label`.

**F39 additions:** `.ws-material-link` (a button that looks like the material link), `.letter-modal` (centered dialog, 780 px wide, tall plain-text area, full-width sheet at 600 px and below), `.letter-modal-head`, `.letter-modal-foot`, `.letter-modal-file`, `.letter-modal-read`.

**Shell banner fix:** at 700 px and below `.build-banner` is in the page flow (static) and the sidebar gets no top offset, so the banner pushes content down and nothing sits over the theme button.
