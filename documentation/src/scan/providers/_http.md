# src/scan/providers/_http.mjs

**Kind:** shared module
**Purpose:** HTTP context factory and HTML-to-text helper shared by all scan providers. `makeHttpCtx()` returns `{get, getJson, postJson}` built on `requestWithTimeout`, a small `node:http`/`node:https` client with a browser-like User-Agent, a 20 s timeout and up to 5 redirects. `htmlToText()` turns ATS description HTML (including entity-encoded and mojibake'd variants) into markdown-ish plain text. Files prefixed `_` are skipped by the provider loader.

## Run
Not runnable; imported.

## Reads
- Network: whatever URL a caller passes (GET or POST JSON). No files, config or env vars.

## Writes
- none

## Imports
- none (Node built-ins `node:http`, `node:https` only)

## Used by
- `src/scan/scan.mjs` (`makeHttpCtx`, `htmlToText`), `src/scan/providers/_canonical-jd.mjs` (`htmlToText`, `requestWithTimeout`), every provider that normalizes descriptions (`ashby-api`, `greenhouse-api`, `lever-api`, `icims-api`, `pinpoint`, `successfactors`, `workable`, `workable-search`, `workday-api`), `src/scan/test-hiring-cafe.mjs`, `src/helpers/verify-portals.mjs` (builds its bounded probe context).

## Notes
- `requestWithTimeout(url, {method, headers, body})` resolves to a fetch-like object: `ok`, `status`, `statusText`, `headers.get()`, `text()`, `json()`. A 303 redirect downgrades to GET and drops the body; other redirects keep the method. Non-http(s) protocols reject.
- `get`/`getJson`/`postJson` throw `HTTP <status> <text>` on any non-2xx response; there is no retry here (retries live in `_canonical-jd.mjs`).
- Default headers: Chrome 124 on Windows User-Agent, `Accept: text/html,...` (`application/json` for the JSON helpers), `Accept-Language: en-US`.
- `htmlToText`: repairs Windows-1252 mojibake only when marker sequences are present and the repair reduces them; unescapes entities up to five passes before and after tag stripping; `<li>` becomes `- `, `<strong>/<b>` become `**...**`, `<span>` is removed without a separator, block tags force line breaks; collapses runs of three or more newlines. Safe to call on already-plain text.
- Observation: `htmlToText` returns the falsy input unchanged (`null`, `''`), which callers rely on with `|| null`.
