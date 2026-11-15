# web

The browser dashboard: React, Vite and TypeScript. `src/server/` serves the production build
(`web/dist/`) on `127.0.0.1:4310`. This README is the whole documentation for this branch; there is
no per-file page.

## Module map (`web/src/`)

| Folder / file | What lives there | May import |
|---|---|---|
| `main.tsx`, `App.tsx` | Mount point; the shell: navigation, theme, connection banner, run polling | everything below |
| `pages/<page>/` | One folder per route: `overview`, `jobs`, `workspace` (a single job), `discover`, `tasks`, `providers`, `service`, `cost` | `components/`, `lib/`, `api.ts`, `generated/` |
| `components/` | Pieces shared by more than one page: run cards and logs, quick status moves, action and publish dialogs, slide panel, model field, error details, report Markdown | `components/`, `lib/`, `api.ts`, `generated/` |
| `lib/` | Formatting, URL/location hooks, error helpers, shared hooks, label tables | `lib/`, `api.ts`, `generated/` |
| `api.ts` | The only place that calls the server: typed client, error classes, the stale/conflict message | `generated/` |
| `generated/api.d.ts` | Wire types generated from `src/server/schemas.mjs`; never edited | nothing |
| `styles.css` | The stylesheet index: `@import`s of `styles/` in a fixed order | `styles/` |
| `styles/` | Every stylesheet: `tokens`, `base`, `layout`, `controls` (shared); `components/<name>.css`; `pages/<page>.css`; `layout-late.css` last | nothing |

Rules for imports: `lib/` never imports a component or page; `components/` never imports a page;
a page does not import another page's internals. One exception is recorded here: the Jobs page
embeds `pages/discover/PasteForm` in its Add job slide-out. `App.tsx` owns the router (hash routes:
`#/overview`, `#/jobs`, `#/jobs/<id>`, ...), so pages receive what they need as props.

Page folders with more than one file:

- `pages/jobs/`: `JobsPage.tsx` (list, filters, URL state); `BatchBar.tsx`, `BatchDialog.tsx` (`styles/pages/jobs-batch.css`)
  (batch evaluate: row checkboxes, the three start buttons, the confirm dialog, the status line with
  Cancel waiting).
- `pages/workspace/`: `WorkspacePage.tsx` wires the pieces. `useJobDetail`, `useWorkspacePanels`,
  `useHeaderActions` hold the data, slide-out and header-button state; `WorkspaceBar`, `ReportPane`,
  `JdPane`, `ToolRail`, `WorkspaceFallback` render the page; `*PanelBody` and `NotesSections` fill the
  slide-outs. `LetterEditor`, `JobActionsPanel`, `DetailsEditor`, `JdEditor`, `StatusControl` are the editors.
- Discard: one popout for every discard (`components/DiscardDialog.tsx`, `lib/discard.ts`): the reasons as tick boxes (one at a time) and an
  optional comment; nothing is required, the confirm button has focus, and an empty discard is sent as "No reason given" (the server
  rejects an empty reason). Stored as "Reason: comment", 200 characters at most. Used by the row Discard, the Status panel and batch
  discard. A double click on a Jobs list row's Discard discards at once (the job page and batch never do); a single click (after 250 ms) or the keyboard opens the popout.
  "No reason given" is never shown as a reason.
- Batch discard: rows that can be evaluated (Pending) or discarded (Pending, Evaluated) get a checkbox; "Discard selected (n)" opens that
  popout (`pages/jobs/BatchDiscard.tsx`) and then calls the single-job status write for each row, three at a time. The result line
  lists any job left as is (changed, gone, refused); the list is read again and the selection cleared.
- Search: the Jobs search box takes AND, OR, NOT, "phrases" and parentheses (server-parsed, 200 characters). A `?` button shows
  three examples; a 400 `q` field error is shown under the box after 0.5 s, the previous results stay, and the next good
  response clears it (`styles/pages/jobs-search.css`).
- Favorites: `components/FavoriteToggle.tsx` (`styles/components/favorite.css`) is the star on Jobs rows and in the workspace header;
  it is optimistic with rollback and only a label (`PUT /jobs/:id/favorite`). The Jobs page adds a "Favorites only"
  checkbox and a "Favorites first" sort, both kept in the URL (`favorite=true`, `sort=favorite`).
- Years of experience: rows show "3+ yrs" under the role (a quiet mark for low or inferred confidence; nothing when there is no
  estimate, `lib/yoe.ts`). The Jobs page has "At most (years)", "Hide jobs with no estimate" (only with a limit) and
  "Years, lowest first", all in the URL (`yoeMax`, `yoeUnknown`, `sort=yoe`); `styles/pages/jobs-table.css`, `jobs-search.css`.
- Posting check: `pages/discover/PostingCheckCard.tsx` (last full check, "Check all now" behind a confirm dialog; the server's daily
  run is not claimed). On the job page `pages/workspace/PostingCheck.tsx` shows the latest check, "Check posting" for one job and
  the "Posting expired on <date>" line for a job the check discarded. The Jobs list marks closed and probably closed rows and has
  a "Posting check" filter (`posting=expired|applied-closed`). Shared wording is in `lib/posting.ts`.
- Job descriptions: `pages/workspace/JdText.tsx` renders the stored text through `components/ReportMarkdown` (no raw HTML, no images,
  links open in a new tab; single newlines kept by `lib/markdownLines.ts`) with a "Raw text" switch. Editing and saving use the raw text.
- Location review: a failed evaluate run with `LOCATION_REVIEW` shows the reason it saved (`detail`) and two answers
  (`components/LocationReview.tsx`): "Location is fine, evaluate" (a new run with `locationConfirmed: true`) and "Not eligible, discard"
  (the discard popout with "Wrong location" ticked). Offered only while the job is Pending and no newer evaluate run exists; the
  nonces come from `lib/capabilities.ts` (a context set in `App.tsx`). The job page shows the same block above the report.
- Run outcome labels come from `lib/runs.ts` (`stateText`, `stateClass`, `errorText`); a failed evaluate run with
  errorCode `LOCATION_REVIEW` reads "Needs a location decision" with a neutral style (`styles/components/run-outcome.css`).

`web/test-api.mjs` and `web/test-support/fixture-server.mjs` are the API-client checks and the
fixture server they run against.

## Run, typecheck, build

- `npm run web:dev` starts Vite on `127.0.0.1:5173` and proxies `/api` to the service on 4310.
  Pass `-- --port <n>` for a spare port when 5173 is taken.
- `npm run web:typecheck` regenerates `generated/api.d.ts`, then runs strict `tsc`.
- `npm run web:build` typechecks, then builds into `web/dist/`. The running service serves that
  folder, so build to a scratch `--outDir` when experimenting, and run `npm run web:restart` after a
  real build so the service picks it up.

## Rules a maintainer needs

- **One stylesheet system.** Every rule lives under `styles/` and loads through the `styles.css`
  index, imported once by `main.tsx`. No other `.ts` or `.tsx` file imports CSS (`src/test-all.mjs`
  fails if one does). A new rule goes in the file of the page or component it styles.
- **Import order is the cascade.** Never sort or reorder the index. Rules that target the same
  element at the same specificity win by position, so a few files sit earlier than their kind
  suggests (`discard-dialog`, `jobs-batch`, `workspace-jd-text`, `discover-posting-check` load
  before one or more of `layout`, `base` and `controls` because some declarations must lose to those),
  some rules sit beside the rule they must follow with a comment naming their owner file, and
  `layout-late.css` holds the few that must come last. A rule that must beat an earlier rule goes
  after it; a dark-theme rule goes after the light rule it overrides. Removing those order
  dependencies (dead declarations, owner-file placement) is open cleanup work.
- **URL state.** Search, filter, sort and pagination live in the URL (`lib/jobsLocation.ts`, the
  Tasks location hook) so reload and back work. Do not mirror them in component state only.
- **Session nonce.** The nonce from `/session` stays in memory and goes out only as a request
  header. It is never rendered, logged, stored or put in a URL.
- **No sample data.** A failed read shows its failure (database unavailable, stale edit, failed
  task). Never substitute placeholder rows. Preserve unsaved input when a write fails.
- **Text, not HTML.** Job descriptions and notes render as text. Evaluation reports go through
  `react-markdown` with no raw HTML and no images. Never use `innerHTML`.
- **Only real endpoints.** Call only routes defined in `src/server/schemas.mjs`; do not add buttons
  for workflows the server does not implement.
- **Accessibility.** Keep focus visible, controls labelled and dialogs keyboard-operable. Check
  1440, 1024 and 390 px in both themes before calling UI work done.
- **No candidate facts** in any file under `web/`.
