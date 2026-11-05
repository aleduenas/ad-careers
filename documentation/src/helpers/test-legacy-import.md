# src/helpers/test-legacy-import.mjs

**Kind:** test
**Purpose:** Unit test for the `audit()` half of `src/helpers/import-legacy.mjs`. It writes small fixture versions of the retired tracker files into a temp folder and checks ID normalisation, recovery of an explicit historical application date, tracker-over-pipeline precedence, fingerprint stability, missing-report warnings, URL-based duplicate removal, conflicting-URL errors and detection of unmerged batch outputs.

## Run
`node src/helpers/test-legacy-import.mjs` with no arguments. No database or Docker needed. Run by `.github/workflows/database.yml` and discovered by `src/test-all.mjs`.

## Reads
- none from the repository (all input is generated in the temp folder)

## Writes
- `<os tmpdir>/career-import-test-<random>/` containing `data/pipeline.md`, `data/applications.md`, `reports/001.md`, `data/id-counter` and `batch/tracker-additions/3.tsv`; removed in `finally`

## Imports
- `src/helpers/import-legacy.mjs` (`audit`)

## Used by
- `.github/workflows/database.yml`
- `src/test-all.mjs` (section 2, discovered)

## Notes
- Fixture links the tracker report as `../reports/001.md`, matching the pre-layout convention `audit()` resolves relative to `data/`; the expected `report_path` is `reports/001.md`.
- Expects `lastAllocated` to come from `data/id-counter` (9) when it exceeds the highest record ID.
- Asserts `audit()` is pure: calling it twice on the same input yields the same fingerprint.
