# src/lib/_cached-jd.mjs

**Kind:** shared module
**Purpose:** Locates the cached JD markdown file for a job under `data/jds/`. It first tries the conventional path `data/jds/<company-slug>/<role-slug>.md`; if that is absent it scans every cached JD for a URL identical to the job's posting URL. It exists because company display names and scan-time folder names can differ, and the module deliberately refuses fuzzy title or employer matching.

## Run
Not runnable; imported by other modules.

## Reads
- `data/jds/<company-slug>/<role-slug>.md` (exact candidate)
- `data/jds/**/*.md` (full read of every file when falling back to URL matching)

## Writes
- none

## Imports
- none (Node built-ins only)

## Used by
- `src/eval/_evaluation-cli.mjs`
- `src/helpers/import-legacy.mjs` (`audit` links legacy records to cached JDs)

## Notes
- Export: `findCachedJD(root, job)` where `job` has `company`, `role`, optional `url`, and `num`/`id` for error messages. Returns an absolute path or `null`.
- URL identity normalises by dropping the fragment and sorting query parameters; trailing `),.;` characters are stripped from URLs found in file text.
- Throws "Ambiguous cached JD for #N" when more than one file contains the same URL, rather than guessing.
- Slug rule: lower-case, non-alphanumerics collapsed to `-`, trimmed. It must match the slug rule used at scan time or the exact-path branch never hits and every lookup falls through to the (slower) full scan.
