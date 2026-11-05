# Audit completion report

**Authority:** current source, database constraints, and the commands below. Verified on
2026-09-20. This supersedes the outstanding-work list in session 06. Earlier detailed
records were copied and byte-verified under the private
`data/archive/audit-completion-2026-09-19/` before public summaries replaced them.

## Where the interrupted work stopped

The layout and most consolidation work had landed in the working tree, but many component
pages were absent and the advertised documentation coverage check did not exist. The first
documentation pass filled those pages and identified the implementation gaps below. This
completion pass addressed those gaps as well as smaller source/documentation mismatches.

## Completed work

| Previous gap | Result and evidence |
|---|---|
| Missing documentation | Component pages, current command paths, navigation and [file reference](../../reference.md) completed. The harness checks pages for 132 source/configuration files, including JSON examples. |
| PDF root and missing fonts | Shared repository root, embedded local WOFF2 fonts, loaded-font checks and actual Chromium rendering. Both bundled families and extended Latin are covered by [the render test](../../src/cvgen/test-pdf-render.md). |
| Backup/restore not exercised | [The database runner](../../src/helpers/db-test.md) now runs the restore and drafting tests. Restore uses isolated databases, the supplied connection, and verifies that the Compose and SQL connections refer to the same cluster. CI provisions Compose and Chromium. |
| Aggregator JD provenance and cache behavior | AI-processed description fields cannot stand in for original JDs. [Provider fixtures](../../src/scan/test-hiring-cafe-provider.md) cover fresh contexts, TTLs, malformed/empty responses, filtering, dry-run immutability and stopping live requests after 403/429. |
| Backup checkpoint retention | A sibling `<dump>.keep` preserves a dump independently of the newest-five rule. [Retention tests](../../src/helpers/test-prune-logs.md) cover protected older dumps. A marker is a retention instruction, not evidence of a successful restore. |
| Repeated-role artifact collisions | New drafts use `output/<company>/<role>--<job-id>/`. Dashboard lookup prefers IDs and rejects ambiguous ID folders. Legacy folders remain readable; no existing personal output was moved. Node and Go fixtures cover separate postings and legacy fallback. |
| Housekeeping | Unused manual template and stale scheduled-task lock archived after verification; rebuildable private virtual environment and empty stale output directory removed. Development MCP/settings and the story-bank scaffold deliberately retained. |
| Old examples and sync notes | Minimal runtime-supported examples, JSON config examples and setup instructions added. Private full/compact metadata and path references reviewed without changing candidate facts. |
| Workflow acceptance | Real launchers execute ingestion, duplicate rejection, status transitions, evaluation publication, combined drafting and letter publication against isolated synthetic fixtures. Real Chromium produces the PDFs. |

Additional fixes include literal-safe prompt substitution, two-to-three-project validation,
idempotent initial JD synchronization, root-relative analytics report loading, Lever
pagination, Pinpoint detection, Toronto-area filtering, pasted-URL validation, and preview
modes for intake/status commands. Obsolete imports and fixture paths were corrected.
The corresponding source pages and regression checks describe each contract.

## Validation results

| Check | Result |
|---|---|
| `node src/test-all.mjs --quick` | 143 passed, zero failures, five prerequisite warnings. |
| `node src/test-all.mjs` | 144 passed, zero failures, five prerequisite warnings; includes a temporary dashboard build. |
| `node src/helpers/db-schema.mjs --check` | Snapshot matches immutable migrations. |
| `node src/helpers/db-test.mjs` | Passed legacy import, SQL concurrency/revision/workflow checks, evaluation launcher integration, intake/drafting/publication, custom-format backup/restore, and Go integration tests. |
| `node src/cvgen/test-pdf-render.mjs --render` | Passed actual Chromium render and bundled-font assertions; one-page synthetic PDF inspected visually. |
| Dashboard `go vet ./...`, `go test ./...` | Passed. |
| Dashboard `go build -o dashboard.exe .` | Actual dashboard binary rebuilt. Opened the pipeline in a terminal and exited cleanly. |
| `node src/helpers/verify-pipeline.mjs` | All 742 inspected jobs had valid referenced artifacts. |
| `node src/helpers/verify-portals.mjs` | 59 portals classified: 38 structured, 21 rich/manual-only, zero unclassified; no structured-provider errors. This is not a claim that every manual site was reachable. |
| Scanner dry-run | 38 structured and 21 rich/manual-only portals; 35 successful, three empty, zero provider errors. No jobs were saved. hiring.cafe blocking was respected. |
| PDF visual inspection | Synthetic CV and letter rendered with readable text and no clipping; fixture prose validates layout, not model writing quality. |
| Documentation links | Local Markdown link targets checked after completion; no missing targets. |

The quick/full harness warnings are expected skips for database-backed tests and the explicit
Chromium render test. Those checks passed separately with their prerequisites. The intermittent
Windows runtime test failure was later traced to removing the temporary directory before a
timed-out child had fully closed. The runtime now rejects on child closure, and the timeout
and integration regressions pass. The harness also prints failed subprocess diagnostics. A Windows Go cache permission
failure was resolved before the successful build and tests above.

Local evidence is private under `logs/tests/audit-acceptance/` (suite and scan output),
`logs/tests/pdf-render/`, and `logs/tests/drafting-integration/rendered/`. Never commit it.
Integration fixtures isolate database writes and model responses. The initial pass used the
personal database read-only. The later authorized live acceptance evaluated two Pending jobs
through the normal launcher: one became SKIP after the location gate, and one became
Evaluated. Its CV and letter were generated separately for acceptance, regardless of its
score. No applications were sent.

## Live Claude acceptance and latest-change recheck

After the user confirmed Claude allowance was available, these checks passed:

- Claude subscription doctor and synthetic evaluation smoke. Evidence:
  logs/evaluation/smoke-0a37f49e-ac5e-4113-98d7-a285b8168fd7/.
- A real cached-JD location rejection, then a successful real evaluation. Evidence:
  logs/evaluation/2026-09-20T14-36-33-802Z-2c5be053/ and
  logs/evaluation/2026-09-20T14-36-55-969Z-b4bed848/.
- Combined CV and cover-letter generation with the live Claude subscription. Evidence:
  logs/drafting/runs/2026-09-20T14-42-04-097Z-339e0c56/.
- Actual letter publication. Evidence:
  logs/publishing/2026-09-20T14-42-59-470Z-75123ff3/.
- Visual inspection of both CV pages and the one-page letter: readable text, no clipping,
  correct section flow and deterministic greeting/sign-off. Images are private under
  logs/tests/audit-acceptance/live-cv-*.png and live-letter.png.

Live inputs exposed two additional bugs: template-like text inside supplied evidence was
incorrectly rejected, and customization extraction stopped after the first paragraph.
Both are fixed with regression coverage. Substitution now validates the source template's
keys and preserves inserted evidence literally. The complete customization block, including
historical heading punctuation and CRLF input, reaches the CV worker.

One CV response failed the existing three-word competency limit and was preserved without
publication. The worksheet now explicitly asks for whitespace-based counting; the next
live run passed. The failed run remains under
logs/drafting/runs/2026-09-20T14-40-32-421Z-b834d627/.

A subsequent review checked Claude's newer dashboard compensation/grouping changes and
worksheet/catalog project additions. Quick tests, isolated database/drafting acceptance,
Go vet/tests, schema comparison and pipeline reference checks pass. The existing dashboard
binary was built after the latest dashboard source changes. Latest worksheet keys match
the private catalog. The live outputs above retain their original prompt snapshot; they
were not regenerated merely to include a newly available optional project slot.

The earlier 429 and missing Codex login are historical diagnostic results, not a current
blocker for the verified Claude path. Codex live generation was not tested.

## Remaining manual review limits

The complete interactive dashboard intake/status/evaluate/draft sequence has not been
replayed end to end. Its launchers and UI components have automated coverage, and the
actual dashboard was opened successfully. A human comparison with a previously approved
CV/letter and final factual/style approval remain outstanding; rendered drafts are not
approved applications. Standalone free-text letters remain less constrained than the
combined JSON worksheet.

All changes remain local in the existing mixed working tree; no commit or push was made.
