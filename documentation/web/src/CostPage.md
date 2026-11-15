# web/src/CostPage.tsx

The Cost page (package 4.7). It reads `GET /api/v1/cost/summary?range=` and `GET /api/v1/cost/calls?range=&limit=50`
through `api.costSummary` and `api.costCalls`; it never substitutes sample data.

- **Availability.** `App.tsx` shows the Cost nav entry only when the session capabilities carry `cost: true`. Without
  it `#/cost` shows an "unavailable" card.
- **Range.** Chips 7 days, 30 days (default), 90 days, All time. The range is the `range` query parameter, so it
  survives reload and back.
- **Mode.** `Tokens | API price`, default Tokens, remembered per browser in localStorage under
  `career-ops-cost-mode` (reads and writes are in try/catch). Every figure follows it: cards, tables, day bars and recent
  calls. `estimatedUsd` null shows "n/a". In price mode one quiet sentence says it is the subscription plan priced at
  public API rates and lists `unpriced` models when there are any.
- **Sections.** Totals cards (compact figures such as 1.2M, with the exact value as the title), per day bars (plain CSS,
  each bar focusable and labelled with day, value and calls, shown on hover and focus, plus a details table with the same
  figures), per model, per function and per job tables (a null job reads "No job (scan, intake)"; job rows link to
  `#/jobs/<id>`), and the 50 most recent calls.
- **States.** Loading, error with Retry (database errors shown as a warning), and an empty state when the range has no
  calls. Recent-calls failures are reported inside their section without hiding the totals.
- **Layout.** Flat panes; tables scroll inside focusable regions; styles are `.cost-*` in `styles.css`.

## Real-data fixes

- **Per day gaps.** The server returns only days with calls, so `fillDays` adds a zero bar for every calendar day from the range start (or the first day with calls for All time) to today. Quiet days read as quiet, and labels are dates every few bars. A chart wider than its pane starts scrolled to the newest days.
- **Per job.** The table shows the top 15 rows with a "Show all N jobs" toggle, because 100 rows made the page 17,000 px tall at 390 px.
- **Model ids** (`claude / claude-haiku-4-5-20251001`) never wrap inside the id; the table scrolls instead.

## Review fixes (4.7)

- **Per day chart is one tab stop.** Bars use a roving tabindex: Tab enters the chart on the newest day, Left and Right move between bars, Home and End jump to the first and last. The table alternative stays available under the chart.
- **Region names.** Every scroll region is named "<section> table" (for example "Per model table"), so none repeats its section heading's name; the chart's list is "Per day chart".
- **URL.** `?range=` is removed (history replace) when the Cost page unmounts.
- **Partial sums.** A group with `unpricedCalls` above zero and a non-null `estimatedUsd` shows the amount with a trailing "+", a tooltip and an accessible name "N calls not priced" (cards, tables, day bars); a missing field counts as zero.

## Estimated drafting history (D093)

- **Switch.** An "Include estimates" checkbox sits beside the Tokens | API price toggle (default on, remembered under `career-ops-cost-estimates`, sent as `estimates=include|exclude` on both calls).
- **Marks.** Where a group has `estimatedCalls` above zero, the calls count, the total tokens or USD (tables and cards) and the day bar labels carry a small "est." mark with the accessible name "N estimated calls"; it sits next to the "+" mark when both apply. Missing fields count as zero.
- **Recent calls.** Rows with `source: 'estimate'` are tagged "estimated".
- **Sentence.** With estimates on and `totals.estimatedCalls` above zero, one quiet sentence says drafting before Nov 12, 2026 was not logged and is estimated from prompt and response sizes and call durations.
