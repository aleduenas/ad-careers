# src/scan/providers/lever-api.mjs

**Authority:** [src/scan/providers/lever-api.mjs](../../../../src/scan/providers/lever-api.mjs).

Paginated Lever provider.

## Run and callers

Dynamically loaded for jobs.lever.co board URLs. Reads careers_url/name and optional max_pages (default 100).

## Inputs

Requests pages of 250 with skip offsets, rejects invalid/repeated pages and fails rather than returning silently truncated data at the cap. Includes description, requirement/list sections and closing content in the JD.

## Behavior and outputs

Returns normalized job records; no filesystem/database writes. Uses `_http.mjs::htmlToText` and the caller's getJson. `test-lever.mjs` covers 251 postings, repeated pages, caps and JD sections. Pagination contract: [Lever's API documentation](https://github.com/lever/postings-api#get-a-list-of-job-postings).
