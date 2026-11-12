# src/server/test-providers.mjs

**Kind:** synthetic Node test suite for `src/server/providers.mjs`. Run with `node --test
src/server/test-providers.mjs`. Every case uses a temporary root; the private
`config/llm-providers.json` and the real launcher configs are never read or written, and no
provider command is run. Cases: legacy derivation (launcher defaults, configured values, the empty
`codex_model` fallback, garbage ignored); `get` with no file is read-only and creates nothing;
the `put` validation matrix (function, revision, provider, model, extra keys) writing nothing; the
first save materializing all four functions with the file hash as revision and later saves keeping
the other functions; stale or legacy revisions as `SETTINGS_CONFLICT` with the current document
and an unchanged file; three concurrent saves from one revision (one wins); a failed write
(safe error, no temporary file, old file kept); malformed settings files as `SETTINGS_UNREADABLE`
without echoing contents; readiness with a fake login runner (ready, not logged in, unavailable,
timeout, commands from `cv-drafting.json`, no credentials or paths in results, shared concurrent
check); the login message classifier; `resolve` per action; and adapter validation.

Stage 3.5 case: a BOM-prefixed valid file is read (revision of the raw bytes, `resolve` works) and a
BOM-prefixed file that still fails to parse stays `SETTINGS_UNREADABLE`.

D066 test: default lists, a valid override that survives a save, invalid overrides ignored, and a configured model outside the list kept.

Intake test: an optional `functions.intake` entry is not listed in the document and survives a save.
