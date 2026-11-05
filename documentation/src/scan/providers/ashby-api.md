# src/scan/providers/ashby-api.mjs

**Kind:** provider
**Purpose:** Ashby job-board provider (`id: ashby`). Lists every posting for a board through Ashby's public posting API and pulls the full description from the list payload or, when absent, from the per-posting endpoint. Returns `{title, url, company, location, content}` per job.

## Run
Not runnable; loaded dynamically by scan.mjs.

## Reads
- `config/portals.yml` entry: `ashby_board` (explicit slug) or `careers_url` containing `jobs.ashbyhq.com/{slug}`; `name` becomes the company.
- Network: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}` (reads `jobs` or `jobPostings`), then `GET .../job-board/{slug}/job-posting?jobPostingId={id}` only for postings whose list entry lacks `descriptionHtml`/`description`.

## Writes
- none

## Imports
- `./_http.mjs` (`htmlToText`)

## Used by
- `src/scan/scan.mjs`: detector `entry.ashby_board || careers_url.includes('jobs.ashbyhq.com/')`, or explicit `provider: ashby`. First in alphabetical detect order.
- `src/scan/test-scan-coverage.mjs` (fixture `getJson`).

## Provider contract (providers only)
- detector: `ashby_board` field or `jobs.ashbyhq.com/` in `careers_url`.
- discovery: single board list call.
- JD retrieval: structured HTTP (`descriptionHtml`/`description` from the list, else the posting endpoint), 5 concurrent detail requests; detail failures leave `content: null`.
- rate/ban handling: fixed concurrency of 5; no retries.

## Notes
- URL is `jobUrl` or `https://jobs.ashbyhq.com/{slug}/{id}`; location is `location`, `locationName`, or `Remote` when `isRemote`/`workplaceType === 'Remote'`.
- Does not consult `ctx.shouldFetchContent`, so detail requests are made for every posting on the board, including ones the title filter will drop.
