# src/server/intake-fetch.mjs

**Authority:** `documentation/dashboard-migration/packages/4.6-url-intake.md` (D080).

URL intake for the browser: given a posting URL, return the company, role, location and full JD text
so the owner can review the form and press Add. `createIntakeFetchService({ rootDir, env,
readConfig, lookupHost, resolve, pageFetch, httpFetch, resolverBudgetMs, firecrawlTimeoutMs })`
returns a frozen `{ fetch }`. Every adapter can be injected; tests inject all of them. Nothing is
inserted, no file is written and no launcher runs. It is called at intake only, never during
evaluation or drafting.

**fetch({ url })** runs these steps and returns `{ url, company, role, location, text, source,
method, warnings }`:

0. **hiring.cafe is refused.** `hiring.cafe`, `hiringcafe.com` and subdomains get 422 `INTAKE_FETCH_EMPTY` ("hiring.cafe pages are not fetched; use the employer's apply link or paste the description.") before any fetch, resolver or Firecrawl call, per the AGENTS.md hiring.cafe contract.
1. **Validate.** Strict body (`url` only, at most 2048 characters). The URL is normalized with the
   launcher's `normalizeUrl` (the same as `/intake/check`), must be http or https, must hold no
   login, and must not point at `localhost`, `*.local`, or any loopback, private, link-local,
   carrier-grade, multicast or unspecified address, checked on IP literals and on every DNS answer
   (`isPrivateAddress`). Failures are 400 `INVALID_REQUEST` with `fields.url`.
2. **Resolver.** Unless the host is `linkedin.com`, `indeed.com` or `glassdoor.com` (or a subdomain), call `fetchCanonicalJobDescription({ apply_url })` from
   `src/scan/providers/_canonical-jd.mjs` (read-only; its rendered Playwright fallback is not used)
   after first trying `fetchAtsJobPosting` (same file), which returns text plus company, role and location straight from a known ATS's JSON (Greenhouse fills all three). Fields still null are filled from a JSON-LD `JobPosting` block on the page (a second request, skipped when all three are set): `hiringOrganization.name`,
   `title` and `jobLocation` (locality, region, country; several places joined with `; `; a
   `TELECOMMUTE` posting adds `Remote`). The whole step has a 20 s budget; on timeout whatever was
   found stands. Field values are plain text, at most 300 characters.
3. **Firecrawl.** Only when the host is excluded or step 2 gave no text: one `scrape` call for
   markdown only (one credit; `onlyMainContent`, no JSON format). Its markdown becomes the text, with
   `source` `firecrawl` and `method` `firecrawl-scrape`. Text is trimmed and capped at 1 MB with a
   warning.
4. **Extraction.** For every source except a known ATS's own JSON (`greenhouse`, `lever`,
   `ashby`, `smartrecruiters`, `workday` skip it), the text goes through `intake-extract.mjs` (one
   cheap isolated model call). A valid answer fills company, role and location only where they are
   still null, replaces the text with the cleaned description, appends `+llm` to `method` and adds the informational warning "Cleaned by model: kept N of M characters." (for
   example `firecrawl-scrape+llm`). An unusable answer keeps the fetched text and adds the warning
   "Model extraction was discarded; text kept as fetched."; a CLI failure adds "Model extraction
   failed; text kept as fetched."
5. **Result.** No text from either fetch step is 422 `INTAKE_FETCH_EMPTY` ("Nothing readable at that
   address; paste the description.", plus the not-configured or invalid-key hint when that was the
   cause). Firecrawl is not needed when the resolver gave text, so a missing key is only reported when
   there is nothing else. A Firecrawl failure (401, 402, 429, other non-2xx, timeout, network error,
   unreadable reply or `success: false`) is 502 `INTAKE_FETCH_FAILED`, `Firecrawl fetch failed:
   <short reason>.`, never the key and never Firecrawl's body.

**Firecrawl API, pinned to v2** (checked against docs.firecrawl.dev on 2026-11-11): `POST
https://api.firecrawl.dev/v2/scrape`, `Authorization: Bearer <key>`, body `{ url, formats:
["markdown"], onlyMainContent: true, timeout: 30000 }`, reply `{ success, data: { markdown,
metadata: { statusCode } } }`. Only the posting URL leaves the machine.

**Key:** `FIRECRAWL_API_KEY` (wins) or `config/firecrawl.json` `{ "version": 1, "apiKey": "..." }`,
read on every call, so adding it needs no restart. It exists only in the Authorization header: not
in logs, responses, errors, warnings or process arguments. The example file is
`config/examples/firecrawl.example.json`.

**Known limit:** the resolver's HTTP helper follows redirects without re-checking the address, so a
public page that redirects to a private address is not stopped by step 1. Step 1 stops the direct
cases (the server pointed at itself or the local network).

**Tests:** `node --test src/server/test-intake-fetch.mjs` (mocked HTTP, extractor and key file only).
