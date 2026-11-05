# src/helpers/verify-portals.mjs

**Kind:** admin command
**Purpose:** Audits `config/portals.yml`: classifies every tracked company as structured (has a scan provider), rich-only, retired or unclassified, probes structured providers with a small HTTP budget to see whether they respond, and checks that rich-only careers URLs are reachable. It never writes user data or the database and is meant to catch broken portal entries before a scan wastes a run on them.

## Run
`node src/helpers/verify-portals.mjs [--include-disabled] [--strict] [--json] [--company NAME | --company=NAME]` (alias `npm run verify:portals`)
- `--include-disabled`: also audit entries with `enabled: false`
- `--company`: case-insensitive substring filter on the company name
- `--json`: emit `{schema_version, generated_at, summary, portals}` instead of the icon table
- `--strict`: exit 1 if any enabled entry is a structured error or unclassified

## Reads
- `config/portals.yml` (`tracked_companies`), resolved relative to the current working directory
- Network: at most 4 HTTP requests per structured provider (`REQUEST_BUDGET`), and one `GET` per rich-only careers URL

## Writes
- none

## Imports
- `src/scan/providers/_http.mjs` (`makeHttpCtx`)
- `src/scan/scan.mjs` (`loadProviders`, `resolveProvider`)

## Used by
- `package.json` script `verify:portals`
- `src/scan/test-scan-coverage.mjs` (imports `classifyPortal`, `verifyPortalEntries`)
- `src/test-all.mjs` lists it as a required system file

## Notes
- Exports `classifyPortal(entry, providers)` and `verifyPortalEntries(entries, {providers, httpCtx, includeDisabled, companyFilter})`; `main()` runs only when the file is the entry point.
- Provider probes run with `probe: true`, `dryRun: true` and `shouldFetchContent: () => false`, so no JDs are fetched. Hitting the request budget is reported as `ok` with `partial: true`, not as an error.
- Row statuses: `ok`, `empty`, `error`, `rich-only` (with `reachability`), `retired`, `unclassified`.
