# `web/src/App.tsx`

Authority: this component implements the browser shell against the read-only API client. It provides
stable hash routes for Overview, Jobs, Discover, Tasks and Providers; separate health,
database-readiness and session states; retry controls; an accessible connection dialog; and a
light/dark theme action. The connection details use the browser's native modal dialog, including
Escape dismissal, focus containment and return to the invoking control. The skip link focuses main
content without changing the active route. Only the cosmetic theme preference is stored in guarded
local storage.
The session response stays in component memory and its nonce is never rendered. Routes describe
current availability without displaying unavailable job data or implying active workflow actions.
Endpoint reads run independently and are aborted when a newer refresh supersedes them.
On narrow screens, keyboard focus in the horizontally scrollable navigation adjusts that nav's
scroll position so the focused link and its focus ring remain visible without moving page content.

## Overview and Jobs pages (package 2.1)

`OverviewPage` calls `api.overview(signal)` and shows four metric cards, the pipeline status counts,
the progress funnel with its three rates, the score distribution and the weekly added counts under
the label "inferred from current statuses and notes". `JobsPage` calls
`api.jobs(query, cursor, signal)` and shows a search box, filter, sort, direction, rows-per-page
and group-by-status controls, grouped or flat tables (company and role, status, score,
compensation, dates, CV and letter badges, discard reason), a result count and previous/next page
buttons. Empty company or role text is shown as "Company missing" or "Role missing"; null dates
show "Unknown"; compensation states map to fixed wording and never invent a value. All job text is
rendered as text.

URL state: the query (`q`, `filter`, `sort`, `direction`, `grouped`, `limit`) and the opaque
`cursor` live in `location.search`; the route stays in the hash. The page reads them on mount and
on `popstate`, so reload, back and forward restore the same view. Changing a control pushes a
history entry and drops the cursor; typing in search pushes one entry per typing session and
replaces it afterwards. Changing sort resets direction to the contract default (company ascending,
others descending). A superseded request is aborted and its result ignored.

Cursor reset: if the server answers `INVALID_REQUEST` with a `cursor` field error, the page replaces
the URL without the cursor, keeps every other filter, shows a notice and reloads the first page.

States are distinct: loading, request error with Retry (safe message only), "No jobs yet" (empty
database: no search, filter "all non-pending", zero rows), "No jobs match these filters" and
"No jobs on this page". No sample data replaces a failed read. The page offers no edit or workflow
actions.

## Job workspace and 2.1 carry-overs (package 2.2)

Route `#/jobs/<id>` renders `WorkspacePage` (the Jobs nav entry stays current and the page title is
"Job workspace"). Rows in the Jobs table link to it with `location.search` kept in the href, so the
list query string is untouched and browser back or the "Back to jobs" link restores the same list
state. An id that is not a positive integer shows "Job not found" without a request.

The page calls `api.jobDetail(id, signal)` once and renders: a header (company, role, ID, status,
score, added and status dates, compensation text, manual salary range, CV and Letter badges, and the
posting link as a plain `rel="noopener noreferrer"` anchor only when a URL exists); a Job description
pane and an Evaluation pane; status history and evaluation history tables; materials with an Open
link per file to `/api/v1/jobs/<id>/materials/<key>` (PDF in a new tab, text kinds in the same tab as
plain text); interview prep (Interview status only); notes; and the discard reason (Discarded only).
JD, report and notes are `<pre>` text, never HTML. At 1024 px and wider the two panes sit side by
side; below that a tablist (arrow keys move between tabs) shows one pane at a time. Every missing
case has its own sentence: no JD, report missing, unreadable or outside the allowed folders, a
recorded evaluation error, no status events, no evaluation runs, no materials, ambiguous output
folders, legacy company/role match, no prep file, no notes, no discard reason, no source link.
Status events with no recorded time show "Not recorded". Loading, not found, database unavailable
and other errors are distinct; only the unavailable and error states offer Retry. The page has no
edit or action controls.

Carry-overs from the 2.1 review: while a new list page loads, the previous results stay mounted
(dimmed, `aria-busy`, summary reads "Updating…") instead of being replaced by the spinner, and
after Next or Previous page the results summary takes focus so keyboard users continue from the new
page even if the pressed button became disabled. The manual salary range is formatted with
thousands separators and one precision for both ends (cents only if either end has them), in the
list and in the workspace.

**Gate delta:** a malformed address such as `#/jobs/abc` now shows "This job address is not valid"
(job IDs are whole numbers) instead of "Job not found", and still makes no request. Material Open
links carry the file name as their `title`. Above the Jobs tables a one-line hint ("Scroll the
tables sideways to see score, pay and dates.") appears below 700 px.

## Workspace editing (package 3.2)

When the session reports `capabilities.jobWrites` as true, `WorkspacePage` renders write controls;
otherwise they are not rendered at all (hidden, not disabled). The session nonce stays in memory in
`App` and is passed down only as a write header. Nothing here starts a worker or run.

- **Status** (`StatusControl`): a select of the seven manual statuses (Ghosted is never offered; a
  Ghosted job shows it as a disabled "automatic" option). Choosing a different status shows a
  Confirm button; Discarded first shows a reason step (list plus details, "Other" needs details,
  200 characters at most, validated inline). Confirm sends the job's current revision.
- **Details** (`TextFieldRow`, `SalaryRow`): inline Edit, Save and Cancel for company, role, source
  link and the manual salary range, with inline validation that mirrors the server rules (non-empty,
  300 characters, http(s) links without credentials, plain decimal amounts, lowest not above highest,
  "Remove the manual range" to clear). Focus moves into the input when an editor opens and back to
  its Edit button when it closes.
- **Job description** (`JdEditor`): an Edit (or Add, when no JD exists) button opens a textarea
  with Save, Revert and Close editor. A dirty guard confirms before in-app link navigation and
  triggers the browser's leave warning; unsaved text is also kept in memory for the session and
  restored, in an open editor with a note, when the user returns. `cacheSync: 'error'` shows
  "saved to the database, cache file not updated".

Conflicts never discard input. After any 409 (`REVISION_CONFLICT`, `FIELD_CONFLICT`, `URL_IN_USE`,
`JD_CONFLICT`) the page silently re-reads the job and shows the stored value or status and revision
next to the user's kept input. The user then chooses: confirm again or "Save over stored value" or
"Save over current version" (the guard moves to the stored version), "Use stored value", or for the
JD "Load current text" (keeps the user's text aside, "Restore my text" brings it back). A 403 says
the session is no longer valid and asks for a reload. Material Open links now include the file name
(`/materials/<key>/<name>`) so the PDF tab is titled with it.

## Discover page (package 3.3)

`DiscoverPage` (route `#/discover`) shows two cards chosen from the session: the paste form when
`intake` is true and the scan card when `taskDispatch` is true. With neither it says Discover
is unavailable, and until the session loads it says it is waiting. There is no LLM, model or
provider selector; everything here is deterministic.

**Paste form (`PasteForm`)** follows the TUI's order. 1. Posting link and "Check link" (Enter in the
field also checks); the server answers whether the link is tracked or only seen in a scan.
A tracked link is blocked with a link to `#/jobs/<id>` and no further fields. A scan-only link
shows a confirm step (Add it anyway, or Use a different link). Editing the link resets the check.

**Fetch (package 4.6).** A primary Fetch button sits beside the link field and Enter in the field
now runs it (Check link stays for the paste-yourself path). Fetch runs the duplicate check first; a
tracked link is never fetched. Otherwise it calls `api.intakeFetch` and, while it runs, shows
"Fetching…" with every field disabled. Company, role and description are filled only when empty or
still equal to the value of the previous fetch (`fillFetched`, last values kept in a ref), so the
owner's typing is never overwritten. A returned location is prepended as a `Location: …` line
(`withLocation`) unless the text already mentions it. Server warnings show as one quiet line under
the link. A failed fetch (422, 502, 503, or a missing route) shows its message under the link field
as `field-error`, the form stays open and editable, and nothing is substituted.
2. Company, with suggestions from `/intake/companies` in a native datalist (debounced, up to 10).
3. Role. 4. The job description in a textarea, kept byte for byte as typed (only a 100 character
minimum is checked, on the trimmed text, with a live count). 5. "Preview pasted JD", which shows company,
role and where the text would be stored. Add job stays disabled until a preview succeeds for the
current inputs; changing anything afterwards asks for a new preview. Success links to
`#/jobs/<id>` and clears the form. Every failure keeps the inputs: field errors appear beside
their field, `DUPLICATE_JOB` is final (no force), `SEEN_URL` from the server offers "Add it anyway"
and then sends `force: true`, and `DISCOVERY_BUSY` names the active scan (or says another intake is in progress when there is none).
`DUPLICATE_JOB` also links to the tracked job the server reports. The server only says "Invalid value."
per field, so the page shows a plain message for each known field. A 403 asks for a reload.

**Scan card (`ScanCard`)** has an optional company filter, "Dry-run scan" and "Run scan",
which POST a `scan` run. It finds the latest scan run when the page opens, polls the run every two
seconds while it is queued or running (both buttons and the filter are disabled meanwhile), shows
its state and step, and offers "Show log tail" which follows the log while the scan runs. When a
run completes it reads the scan report and shows the summary numbers and the "Missing full JD" list
(company, title, and a Posting link only for real http(s) addresses), whether it was a dry run, when it
was generated, and a collapsible per-company results table. A failed run shows its
code; a finished run whose report cannot be read says so rather than showing old numbers.
`DISCOVERY_BUSY` shows the active run and its live state.

## Providers page (package 3.7)

`ProvidersPage` (route `#/providers`) reads `GET /settings/providers` and shows two cards. The first
has four rows (Evaluation, Company research, CV, Cover letter). Each row has a provider select
(Claude or OpenAI, wire keys `claude` and `codex`), a model field, a source badge ("Saved setting"
or "From existing config, not saved yet") and its own Save button, enabled only when the row differs
from what is stored. The model is validated inline (not empty, 80 characters at most, no control
characters). Save sends the page's current revision with the session header; the first save
materializes all four rows, so every badge turns to "Saved setting". Unsaved input in other rows
survives a save. On `SETTINGS_CONFLICT` the page re-reads the settings, shows the stored provider and
model next to the kept input, and offers "Use stored value"; saving again uses the fresh revision.
A server 400 on the model shows a plain message beside the row.

The second card, "Subscription logins", shows a badge per provider (Ready, Not logged in, Unavailable
or Not checked yet) with when it was last checked, and a "Check logins" button that POSTs
`/settings/providers/readiness` (disabled while checking). The fixed guidance, shown only while that provider is not Ready, names the local
commands (`claude auth login`, `codex login`) and says the page never asks for a password or token;
an unavailable provider adds that its command could not be run. There is no credential field
anywhere. Loading and unavailable states are distinct, and the unavailable state offers Retry.
Each readiness entry also shows the server's fixed guidance message when it has one. Editing controls
appear only once the session nonce is known. The Providers navigation entry is hidden when the
session reports `capabilities.providerSettings` as false, and opening `#/providers` then shows an
explicit unavailable state; a failing read keeps the unavailable state with Retry.

## Workspace actions (package 3.4)

When the session reports `capabilities.taskDispatch`, the workspace shows an "Actions" bar (hidden
otherwise, and no run is read) with Evaluate, Draft CV, Draft cover letter and Draft both. Whether
each is enabled, and the visible reason when it is not, come only from `JobDetail.actions`; the page
applies no rule of its own and never shows or uses the score. A disabled button is linked to its
reason text with `aria-describedby`. The 3.5 `publish` entry of the same block is ignored here.

A button opens a modal confirm dialog (`ActionDialog`) that names the job, says the run uses the
subscription command line tool and may take minutes, and lists each function the action uses with its
saved provider and model (from `GET /settings/providers`; if that read fails the dialog says the saved
choice is not shown and still allows an override). Each function has an opt-in override (provider
select, model field, same validation as the Providers page); only enabled overrides are sent, as
`selection`, so defaults stay untouched and the settings file is never written. Escape or Cancel
closes it without a request, Tab stays inside, and focus returns to the button. Start posts
`POST /runs` with a fresh `requestKey` and keeps all input if the call fails.

Runs for the job (`GET /runs?jobId=`) render as run cards with action, state, step, attempt, the
merged selection the server returned, times and a Log toggle. A failed run shows its public error
code; interrupted and completed read as such. While any run for the job is queued or running the page
polls every 3 seconds; when none is active it stops and re-reads the job detail so the bar and the
materials refresh. `PREREQUISITE_FAILED` closes the dialog, shows the reason and replaces the bar's
actions with `error.current.actions`; `RUN_ACTIVE` closes it and shows the active run card. There is no
Retry, Cancel or Resume.

## Navigation and Providers fixes (3.7 follow-ups)

At narrow widths the main navigation is a horizontal scrolling strip. An effect keyed on the page
scrolls that strip, not the page, so the active tab is fully inside it, with a small margin. The
Providers login guidance (`claude auth login`, `codex login`) is now shown for a provider only while
its state is not Ready; the earlier statement that guidance is "always" shown no longer holds.

## Tasks page and active-run count (package 3.6)

`TasksPage` (route `#/tasks`) lists runs from `GET /runs`. One poll, `useRunsMonitor`, lives in `App`
and feeds both the page and the navigation count; it runs when the page is open or the server
reports `taskDispatch`. It polls every 3 seconds while any listed run is queued or running and every
15 seconds otherwise. A failed poll keeps the last list, shows "Reconnecting..." as a polite status
and retries on the same schedule; only a failed first read shows "The task list is unavailable" with
Retry and no stand-in rows.

The table shows action, job link (a dash for scans), state exactly as reported, step and attempt,
provider and model from the run selection (a dash for scan and publish), started, finished, duration
(ticking while running) and the public error code. The page orders rows: active first, then finished
runs, each newest first by creation time. Legacy rows carry a Legacy badge, open to a note that no log or
actions exist, and never offer Start again. "Show more" raises `limit` to 50 (default 12, sent only
when raised). `taskLimit=50` and `run=<id>` of the expanded row live in the URL, so they survive
reload and Back.

Expanding a row shows run fields, an interrupted or failed explanation, a workspace link and, for
browser runs, `RunLogFollow`: the log read by offset cursor (appended, newest at the bottom, scrolled
to the end) every 2 seconds while the run is active, with a Pause toggle that stops reading until
"Continue following". A completed scan shows its report summary.

"Start again" appears only for a failed or interrupted browser run of evaluate, cv, letter or scan,
and only when `taskDispatch` is on. For jobs it reads the job detail first: if the server's `actions`
say the action is no longer available it shows that reason, otherwise it opens the 3.4 `ActionDialog`.
For a scan it opens `ScanAgainDialog`, prefilled from the failed run's dry-run and company options.
Both send a fresh request key and create a new run. Publish run Start again reads the job and the saved letter, then opens the 3.5 publish dialog with the current hash.
There is no Resume or Cancel anywhere. The Start again button stays enabled while the job is read
(it is `aria-disabled`) so focus returns to it when the dialog closes.

The navigation shows a count badge on Tasks (visually hidden text "N active runs") when
`taskDispatch` is on and browser runs are active. The narrow-screen strip re-scrolls to the active tab
when the count changes, because the badge widens the tab.

## Cover letter editor and Publish PDF (package 3.5)

The workspace reads the saved letter (`GET /jobs/:id/letter`) only when the materials list has
`cover-letter.md` with an id or legacy match, and only when the session offers the editor (`jobWrites`)
or Publish PDF (`taskDispatch`). Nothing is read, written or started otherwise.

`LetterEditor` (Materials section, `jobWrites` only, hidden when the letter is not editable) follows the
JD editor: "Edit cover letter" opens a textarea with the saved text and focus in it; Save, Revert and
Close editor; an unsaved-changes note; blank and over-256 KB input refused inline; server validation
shown beside the box. Unsaved text survives navigation within the session and a leave guard asks before
following a link or closing. A save sends the hash it loaded; on `LETTER_CONFLICT` the typed text is
kept, the current saved text can be inspected, "Load current text" keeps the user's text aside and
"Restore my text" brings it back, and "Save over current version" uses the fresh hash. `RUN_ACTIVE` and
`LETTER_NOT_EDITABLE` show plain messages and keep the text. Saving never starts a run and says the PDF
was not changed.

"Publish PDF" is a fifth button in the workspace action bar (`taskDispatch` only). It is disabled with a
visible reason: the server's `actions.publish` reason, "Save first." while the editor is dirty, or a note
when the letter is loading, unreadable or not publishable. A confirm dialog states that it renders the
saved `cover-letter.md` to `cover-letter.pdf` in the job folder, that the PDF is a draft for review, that
nothing is sent and that no provider is used. Start posts `publish` with the letter hash and a fresh key.
`LETTER_CONFLICT` closes the dialog, loads the current saved text and explains that nothing was
published; `PREREQUISITE_FAILED` and `RUN_ACTIVE` use the same handling as the 3.4 actions. The run card
is the 3.4 card; a completed publish run links to the PDF, and when any run ends the letter is re-read so
the "Cover letter PDF (draft)" line (opened through `GET /jobs/:id/letter/pdf` in a new tab) updates.

## Refresh after runs and the "/" shortcut (package 4.1)

`App` watches the navigation active-run count from the existing poll. When it drops, runs have
finished, and `JobsPage` and `OverviewPage` re-read their data through a refresh key. The Jobs list
re-sends the same search, filter, sort, direction, grouping and limit and keeps the cursor (the view
inputs live in the URL); the old results stay on screen until the new ones arrive, and the Overview keeps
its numbers instead of showing the loading state. Unsaved input elsewhere is untouched. The workspace
still re-reads after its own runs.

On the Jobs page, `/` moves focus to the search box unless focus is already in an input, textarea, select,
editable element or dialog, or a dialog is open. The search box carries `aria-keyshortcuts="/"` and a
visible "Press / to search" hint.

## Polish delta (package 4.1, 2026-11-10)

- **Error codes in words.** `errorText` maps the public run error codes (`EXIT_NONZERO`, `SPAWN_FAILED`,
  `QUEUE_STALE`, `PROCESS_GONE`, `STALE_24H`) to short sentences; an unknown code reads "The run did not
  finish." The code stays in a `title` attribute and, in the Tasks detail, as "Code: ...". Run cards show the
  sentence under the badge instead of "failed (CODE)".
- **Links.** `.in-page-link` styles Tasks job ids, "Open the job workspace" and "Open that job" as links.
- **Tasks rows.** A chevron button (`aria-expanded`, label "Show details for the ... run") expands a row; the
  action name is plain text beside it. Below 1100 px the Step, Provider, Finished, Duration and Error columns
  fold into the State cell (including the reason), so a failed run never needs sideways scrolling.
- **Jobs.** Below 1100 px Materials and Discard reason fold into the company cell. Grouped tables use a fixed
  layout so Status, Score and Dates line up between groups.
- **Headings.** The page heading carries the title and a page-specific lead; Jobs and Tasks no longer repeat
  them. The workspace heading is "company · role" with "Job #id" as its lead (`WorkspacePage` reports it to
  `App`). The Service status block shows on the Overview, and elsewhere only when a health, readiness or session
  read fails; the connection pill and Connection details stay on every page.
- **Workspace.** While the JD editor is open the stored text is hidden; "Cover letter" appears once in
  Materials (the editor group is labelled for assistive technology only).
- **Compensation wording.** One phrase per state, shared by Jobs and the workspace: no evaluation yet is
  "Not evaluated"; a report with no readable pay figure (missing or invalid) is "Not stated"; a stated figure
  shows as before.
- **Lows taken.** Fieldset legends are bold form-label size; "Open" links and Back to jobs have a 32 px target;
  an unreadable letter reads "could not be loaded. Reload the page to try again."; the Providers login card
  says "Use Check logins to test it." instead of repeating the badge.

## Package 4.3 deltas (F2-F9)

- **Percentages (F2).** `formatPercent` rounds every overview percentage to at most one decimal and drops a
  trailing zero (33.3333 shows 33.3%, 50 shows 50%).
- **Overview links (F3).** Score bucket rows and Added-by-week rows are links built by `listHref` to the Jobs
  list with `filter=any`. Bucket mapping (`scoreMin` inclusive, `scoreMax` exclusive): 4.5-5.0 `scoreMin=4.5`;
  4.0-4.4 `4` to `4.5`; 3.5-3.9 `3.5` to `4`; 3.0-3.4 `3` to `3.5`; below 3.0 `scoreMax=3`. Week rows use
  `addedWeek=<ISO week>`.
- **Jobs URL state.** `readJobsLocation` and `writeJobsLocation` read and write `scoreMin`, `scoreMax` and
  `addedWeek` (validated, only present when set) and accept `filter=any`. They survive reload, back and
  pagination. An active-filter line ("Score 4.0-4.4", "Added in 2026-W45") has a Clear control.
- **Status chips (F8).** A chip row (All, Pending, Evaluated, Applied, Interview, Offer, Ghosted, Rejected,
  Discarded, Top, Everything) sets the same `filter` value as the dropdown; the selected chip has
  `aria-pressed`. "Everything" is `any` and also appears in the dropdown.
- **Search hint (F4).** The "Press / to search" text is gone; the `/` shortcut and `aria-keyshortcuts` stay.
- **Paste form (F5).** `Add job` is the primary button, enabled when the link check passed and the fields
  validate; `Preview (optional)` is secondary. The "preview again before adding" gate is removed. The preview
  note still shows when a preview matches the current input.
- **Report (F6).** The evaluation report renders through `ReportMarkdown` (see its page). JD and notes stay
  plain text.
- **Status history (F7).** The column is "Source". `actorLabels` maps the actors the server and tools write: `browser` is You (browser), `dashboard` Terminal dashboard (D063: the browser server writes `browser`), `evaluation` Evaluation, `migration` Migration, `cli` Command line, `dashboard-auto` Automatic ghosting. Unknown values show raw. A one-line caption
  sits above the table, and the section is at the bottom with Evaluation history.
- **Workspace order (F9).** Header, Actions bar, a materials strip (CV, cover letter, letter PDF, each opens
  in a new tab; "none yet" when absent), JD and Evaluation report side by side from 1024 px (tabs below that),
  status and details editing, Runs and logs, Materials with the letter editor, Interview prep, Notes, Discard
  reason, Status history, Evaluation history. Run cards are rendered by `JobActionsPanel` into the Runs and logs
  section through a portal (`runsHost`), so the DOM order matches the visual order.

## F10: model dropdowns, readiness, failed-run lines (D066)

- **`ModelField`.** The model is a select of the provider's `models` list plus "Other...", which reveals the
  free-text input ("Other model name"). A configured model that is not in the list selects "Other..." with the
  value shown. `modelAfterProviderChange` keeps the current model only when the new provider lists it, otherwise
  it takes that provider's first model. Used by the Providers rows and the run dialog override.
- **Readiness.** The Providers page runs the login check once when it opens (it is bounded and sends no
  prompt); the "Check logins" button stays. The run dialog shows each function's effective provider readiness
  and a plain "may fail" warning for `notLoggedIn` and `unavailable`; Start is never blocked.
- **Failed run lines.** `RunLastLines` (hook `useLastLogLines`) reads the run log through the existing log
  endpoint in a few bounded pulls and shows the last 3 non-empty lines under a failed or interrupted run card
  (job workspace and Tasks table), in addition to the log buttons.

## F11: full-page workspace (D067)

The job workspace (`WorkspacePage`) no longer uses cards and replaces the older F9 order. It renders without the
global top bar, page heading or footer; the left navigation becomes a slim icon rail (labels stay for assistive
technology and as titles), and the connection pill, Connection details and theme button move into the job top bar
through the `chrome` prop.

- **Top bar** (`.ws-bar`). Back link, title (the page `h1`), then ID, status, score, added and status dates,
  compensation, source link, and the materials links (CV, cover letter, letter PDF, each "none yet" when absent).
  Loading and error states show a bare bar with the back link and "Job workspace".
- **Split.** From 1024 px the evaluation report sits left and the job description right with a draggable divider
  (`useSplitRatio`): `role="separator"`, `aria-valuenow` (25 to 75), pointer drag, arrow keys (2 points, 10 with
  Shift), Home and End. The ratio is remembered in localStorage (`career-ops-ws-split`). Below 1024 px the panes
  stack behind the existing JD and Evaluation tabs.
- **Rail and slide-outs.** A rail at the right edge (a fixed bottom bar below 1024 px) opens one `SlidePanel` at
  a time: Actions (the actions bar plus run cards and logs through the `runsHost` portal), Status (status control,
  details editor, notes, discard reason and a button that jumps to the JD editor, which stays in the JD pane),
  History (status and evaluation history) and Letter (materials list, letter editor, interview prep). Without
  write access the Status button reads Notes and holds only notes and the discard reason. Panels open to about half
  the width from 1024 px and full width below, close on Escape, on their Close button and on the rail button, keep
  Tab inside while open and give focus back to their rail button. Panels stay mounted while closed, so unsaved
  edits, drafts, conflicts and run state survive closing; Escape is ignored while a modal dialog started from a
  panel is on top.

## F12 to F14 (third pass)

- **F12 spacing.** Shared tokens `--gutter` (16 px, 32 px from 701 px, 44 px from 1024 px) and `--content-max`
  (1600 px) live on `:root` for other pages to reuse. The workspace bar and the report/JD split are centred up to
  1600 px, the bar has two separated rows (title and controls; then facts and materials behind a hairline), panes
  have 28 px inner padding, report prose is capped near 75 characters and JD text near 80, and each pane scrolls
  on its own. The divider is unchanged.
- **F13 Add a job on Jobs.** `JobsPage` takes the intake capability and shows a collapsible "Add a job" section
  (closed by default, remembered in localStorage `career-ops-jobs-add-open`) that holds the same `PasteForm` as
  Discover. A successful add calls `onAdded`, which reloads the list, and the form shows its own "Added job #id"
  notice with the workspace link. Discover is unchanged.
- **F14 no raw codes.** `ErrorDetails` shows "Details" with the code and request id; the service status cards
  show the message, and the Connection details dialog says "Unavailable" with the same toggle.

## F15 and F16

- **F15 inline Evaluate.** When the report is missing and the session offers task dispatch, the empty report
  pane shows the usual message plus a primary "Evaluate this job" button when `actions.evaluate.enabled`, or the
  server's reason text when it is not. The button bumps a counter that `JobActionsPanel` watches to open the
  same Evaluate dialog; the dialog is now rendered through a portal to `document.body`, so it opens without the
  slide-out being open. The Actions button reads "Re-evaluate" when a report exists. Both follow the server's
  enabled flag and reason (D070).
- **F16 restart banner.** `App` compares `session.build` with the page stamp (`isStaleBuild`) and shows a
  persistent alert across the top with the restart instructions; the shell gets `has-banner`, which offsets the
  sidebar and the workspace height.

## F17, F18 and F19

- **F17 surfaces.** The page colour is now a green-tinted grey (light) or near black (dark), distinct from `--paper`. The workspace bar, both panes (with a margin of `--gutter` and a border), the tool rail, the slide-outs, the Jobs list and the Jobs controls are paper. The divider keeps its centre at the stored ratio because the left pane's basis subtracts the gutter. Muted text was darkened slightly to keep 4.5:1 on the page colour.
- **F18 Service page.** The connection pill, the Connection details dialog and the service cards are gone from every page. `#/service` (nav entry "Service") holds `ServicePage`: the three status cards with Refresh status and Retry readiness, a Database block, a Session and build block (service build, page build, whether the running copy is older, capability flags, never the session nonce) and a request id table. The nav entry shows a dot only while health, readiness or the session is failing. `App` also sets `data-service` (`connecting`, `ok`, `limited`, `unavailable`) on the shell for the run-checks; it is not shown. The existing error states (health notice, per-page errors) stay.
- **F19 tracked link.** `TrackedNotice` replaces the two duplicate notices in `PasteForm`. It reads "This posting is already tracked as job #id (status). Open it to change its status." For a Discarded job it fetches the job detail and shows the date and reason of the latest discard in the brackets. The link names the company and role.

**PROVIDER_UNAVAILABLE (409):** the run dialog shows the server's message ("The <Claude|Codex> command line tool was not found on this machine.") as its error and stays open; no run exists, so nothing is added to the list.

## F25 and F26

- **F25.** `SlidePanel` sets its own `top` to the bottom edge of `.ws-bar` while open (re-measured on scroll and resize, because the bar scrolls with the page below 1024 px), so the slide-out sits beside the panes at 1024 px and up and below the bar at every width. The bar's buttons stay reachable.
- **F26.** While a slide-out is open, a primary-button `pointerdown` anywhere outside `.ws-panel`, `.ws-rail`, `.ws-divider` or any `dialog` closes it, and focus returns to the rail button that opened it when the press lands on nothing focusable. Rail buttons keep their own toggle, so pressing the open panel's button closes it once. Below 1024 px the panel covers the rail, so the Close button or an outside press closes it. Escape and Close are unchanged. Because the listener uses pointerdown, a drag that ends outside never closes the panel.

## F28 reload banner

The build banner compares the page stamp with the service's `build` (`buildRelation` in `api.ts`, with a 30 s tolerance because the page stamp is taken before the build finishes). A page older than the service reads "The dashboard was updated. Reload this page." and has a Reload button (`location.reload()`). A service older than the page reads "A newer build is waiting for the service to restart." with no button. Neither message contains a command. Dismiss hides the banner until the next load; `dev` on either side shows nothing. The unexpected-response failure and the Service page use the same two messages.

## F31 to F33 (delta 7)

- **Quick moves.** `QuickMoves` shows one green button for the next stage (Pending and Evaluated to Applied, Applied to Interview, Interview to Offer) and a red Reject for Pending, Evaluated, Applied, Interview and Offer. Offer, Rejected, Discarded and Ghosted have no green button. Green is one click; Reject is two (the first turns it into "Confirm reject" for five seconds). Both write through the existing status call with the row's revision, an empty reason and the browser actor, and are disabled while the write runs. A revision conflict shows "This job was changed elsewhere. Its current status is shown." and re-reads the job or the list. Discard and other moves stay in the Status slide-out. It appears only when the session offers job writes.
- **Workspace (F31).** The buttons sit beside the status chip in the top bar; a move updates the chip, date and history without a reload.
- **Jobs list (F32).** A "Move" column holds the same buttons; the row updates in place (the list is not re-sorted or re-filtered until the next load, but with Group by status on it moves to its new group). Messages for a row show above the list so they survive that move. The table is wider and scrolls inside its own region.
- **Jobs toolbar (F33).** No eyebrow or subtitle. One row holds the small Jobs title, the search box (label hidden), compact Sort by, Direction, Rows per page and Group by status controls, and Add job at the right end; the status chips are the second line and replace the old Filter dropdown. Add job opens the paste form in a slide-out (`SlidePanel` with `solo`, below the top bar, at the right edge) that closes on Escape, Close or a press outside, and returns focus to Add job. A new job appears in the list behind it.

## F34 run with the saved settings

Every model action in the Actions panel (Evaluate or Re-evaluate, Draft CV, Draft cover letter, Draft both) has a primary button and a smaller "... with model" button. The primary sends the run request without a selection, so the server resolves the saved per-function settings and runs its own pre-flight; no dialog opens. The run card appears in the Actions panel as before. A refusal (missing provider tool, unreadable settings, session rejected, prerequisite no longer met) is shown as an inline message in the panel instead of a dialog; a run that is already active shows its card. "With model" opens the existing chooser unchanged. The report pane's "Evaluate this job" works the same way (primary dispatches and opens the Actions panel to show the run; its inline message appears under the button) and has its own "with model" button. The Tasks page "Start again" still opens the chooser, and the scan and publish dialogs have no provider choice, so they are unchanged.

- **F35 status-aware quick moves.** `QuickMoves` now follows the status: Pending shows green Evaluate and red Discard, Evaluated shows Apply (move to Applied) and Discard, Applied shows Interview and Reject, Interview shows Offer and Reject, Offer shows Reject only. Reject keeps its two-click 5 s confirm. Discard turns the pair into the inline control built from `DiscardFields`, the same component the Status slide-out now uses (same choice list, 200-character rule and three messages, via `discardReasonText` and `discardProblem`), with Confirm discard and Cancel; Escape or a press outside cancels and Escape returns focus to Discard. The move is revision-checked like the others and the row regroups in place. Evaluate appears only when the page has the dispatch capability. In the job bar it bumps the same request counter as the report pane button, so the Actions panel's `startDirect` runs it with the saved per-function settings and opens the panel; its disabled reason comes from `actions.evaluate`. In the Jobs list it calls `startEvaluation` (same request body through `jobRunBody`, no selection, server pre-flight) and the button then reads "Evaluating…" with a note pointing to Tasks; a refusal shows under the pair. `JobsPage` takes a `dispatch` prop for this.

- **F36 header Draft and Publish buttons.** In the job header the CV and Cover letter cells show "Draft CV" and "Draft cover letter" buttons instead of "none yet" when the material is absent (the existing link when it exists; plain text when the server offers no dispatch or the folder is ambiguous). Letter PDF shows "Publish PDF" when a letter exists and no PDF does, otherwise the link, "none yet" with no letter. There is no second implementation: a click bumps `headerRequest` in `WorkspacePage`, and `JobActionsPanel` runs `startDirect(key, 'header')` (saved per-function default, no dialog, the same enabled and prerequisite guards, `RUN_ACTIVE` handling) or opens the existing publish dialog. The panel reports active run actions back through `onActiveActions` so the cell reads "Drafting…" (or "Publishing…") and is disabled while a run is queued or running; a refusal shows as one line under the materials (`headerIssue`). Buttons are disabled with the reason as a tooltip when the action is not enabled. A quiet line under the materials states the same reason (`.ws-material-reason`), except while the button reads "Drafting…": the label already says a run is active, so no line is shown for it.
- **F37 report tables.** First-column cells never break inside words and have a 9em minimum; other cells 7em and break only for overlong tokens; the table is at least the pane width and scrolls inside `.report-table-scroll` when wider.

- **Fetch waits for the duplicate choice (4.6 delta).** `runFetch` checks first; a tracked link shows its notice and is never fetched, a scan-seen link shows the confirm step and is fetched (`fetchFields`) only when the owner presses "Add it anyway"; a new link fetches straight away.

- **Cost page (4.7).** New `cost` entry in `pages` (nav label Cost, icon `$`), shown only when the session capabilities report `cost: true` (`costAvailable`); the page body is `CostPage` (see CostPage.md). A direct `#/cost` visit without the capability shows an unavailable card.

- **F38 Publish PDF hang (root cause and fix).** `PublishDialog` was rendered in place inside the Actions slide-out. When the header Publish PDF button (F36) opened it, that panel was closed (`display: none`), so `showModal()` made the rest of the page inert while the dialog itself had no box: the page appeared to hang. It is now rendered through a portal into `document.body`, like `ActionDialog`. The header Draft and Publish buttons also no longer disable the Publish button while waiting (only Draft shows "Drafting…" until the run appears), so focus can return to it after Cancel. The Draft buttons go through `startDirect(key, 'header')`, which only dispatches when `live[key].enabled`, once per click, and reads the active run from the panel; they never open a dialog.
- **F39 cover letter modal.** With a loaded letter, the header's Cover letter cell is a button (`ws-material-link`) that opens `LetterModal`, a centered native `<dialog>` (full-width sheet at 600 px and below) rendered into `document.body`. It reuses `LetterEditor` in `dialog` mode: starts in edit mode, plain proportional text, Save keeps the modal open with a saved note, Cancel and the close button and Escape ask before discarding unsaved edits (same prompt as the editor), focus returns to the cell. Publish PDF in the modal calls the same header request as the header button, so it opens the shared publish dialog; it is disabled with "Save first." while there are unsaved edits. "Open file (cover-letter.md, new tab)" keeps the raw file reachable. The CV cell is unchanged. `trapTab` now includes textareas. The workspace Letter panel is left as it was.
- Run-check for the header actions: `documentation/dashboard-migration/reviews/4.3/header-actions-check/run-check.mjs` (fixture server, real slide-outs, 35 checks).
