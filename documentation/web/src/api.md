# `web/src/api.ts`

Authority: this module is the frontend read-only API client. Its only endpoints are the generated
`HealthResponse`, `ReadyResponse`, and `SessionResponse` contracts at `/api/v1/health`,
`/api/v1/ready`, and `/api/v1/session`. It accepts an injected `fetch` implementation for isolated
tests, forwards abort signals, and maps safe server errors and network failures into `ApiFailure`.
The generated declarations in `web/src/generated/api.d.ts` remain the wire-type authority. The
client never exposes session nonces in its errors or presentation.

## Jobs and overview reads (package 2.1)

`createApi()` also exposes `jobs(query, cursor, signal)`, a GET of `/api/v1/jobs` with the six
normalized query fields and an optional `cursor`, and `overview(signal)`, a GET of
`/api/v1/overview`. Both validate the response shape (`JobsResponse`, `OverviewResponse` from
`web/src/generated/api.d.ts`) and reject anything else as `INVALID_RESPONSE`. Server error bodies
become `ApiFailure` with `code`, `retryable`, `requestId` and `fields`, which lets the Jobs page
detect a stale cursor through `fields.cursor`. All error mapping stays in this module.

## Job detail read (package 2.2)

`jobDetail(id, signal)` GETs `/api/v1/jobs/<id>` and returns the generated `JobDetailResponse`.
An id outside `^[1-9][0-9]{0,18}$` fails locally as `NOT_FOUND` without a request. The response
shape (job with notes and evaluation error flag, JD, evaluation report and history, status history,
materials, interview prep) is checked before use; anything else is `INVALID_RESPONSE`. A server 404
arrives as `ApiFailure` with code `NOT_FOUND`; 503 codes `DATABASE_UNAVAILABLE` and
`SCHEMA_NOT_READY` mark the unavailable state. Material files are not fetched by the client: the
page links to `/api/v1/jobs/<id>/materials/<key>` and the browser opens them.

**Gate delta:** a malformed id in `jobDetail` fails locally as `INVALID_REQUEST` with `fields.id`
(the same shape the server returns for a 400), so the page can say the address is invalid instead
of reporting a missing job.

## Writes (package 3.2)

`changeStatus`, `changeMetadata` and `saveJd` send `POST /jobs/:id/status`, `PATCH /jobs/:id/metadata`
and `PUT /jobs/:id/jd` through the same request function as reads, with a JSON body, the
`Content-Type: application/json` header and the session nonce in `x-career-ops-session`. Request
and response types are the generated `JobStatusRequest`, `JobMetadataRequest`, `JobJdRequest`,
`JobWriteResponse` and `JobJdWriteResponse`; responses are shape-checked like reads. Failures become
`ApiFailure` with `fields` (400) and the server's `current` state (409). `conflictCode(error)`
returns `REVISION_CONFLICT`, `FIELD_CONFLICT`, `URL_IN_USE` or `JD_CONFLICT` for the four conflicts,
and `null` otherwise. A malformed id fails locally as before.

## Intake and scan calls (package 3.3)

`intakeCheck(url)`, `intakePreview(body)` and `intake(body)` POST to `/api/v1/intake/check`,
`/intake/preview` and `/intake` with the session header and JSON; `intakeCompanies(q)` GETs
`/intake/companies?q=`. `intakeFetch(url)` POSTs `/api/v1/intake/fetch` (package 4.6) and returns the generated `IntakeFetchResponse` data, checked for field shapes and `source`; 422 `INTAKE_FETCH_EMPTY`, 502 `INTAKE_FETCH_FAILED` and 503 `INTAKE_UNAVAILABLE` arrive as `ApiFailure`. `startScan(body)` POSTs `/api/v1/runs` with `action: 'scan'`, `requestKey`,
`dryRun` and an optional `company`; `runs()`, `run(id)`, `runLog(id, offset)` and
`scanReport(id)` read `/runs`, `/runs/:id`, `/runs/:id/log?offset=` and `/runs/:id/scan-report`.
Responses are shape-checked and anything else is `INVALID_RESPONSE`. Request and response types are the
generated `IntakeSubmitRequest`, `IntakeCheckResponse`, `IntakePreviewResponse`,
`IntakeAddResponse`, `ScanReportResponse` and the scan arm of `RunCreateRequest`. `DISCOVERY_BUSY`, `DUPLICATE_JOB` and `SEEN_URL` arrive as `ApiFailure` codes.

## Provider settings calls (package 3.7)

`providerSettings(signal)` GETs `/api/v1/settings/providers`; `saveProvider(name, body, nonce, signal)`
PUTs `/api/v1/settings/providers/<function>` with `{expectedRevision, provider, model}`; and
`checkProviderReadiness(nonce, signal)` POSTs `{}` to `/api/v1/settings/providers/readiness`.
Responses are shape-checked. Types are the generated `ProvidersSettingsResponse`,
`ProvidersPutRequest` and `ProvidersReadinessResponse`; a save returns the whole settings document,
and the readiness check returns the readiness map (the client also accepts the whole document).
`SETTINGS_CONFLICT` arrives as an `ApiFailure` code.

## Job action calls (package 3.4)

`startJobRun(body, nonce, signal)` POSTs `/api/v1/runs` for evaluate, cv, letter and both, with an
optional `selection` override; `runs(signal, jobId?)` lists runs for a job. `JobActionKey` is the four
dispatchable keys of `JobDetail.actions` (the 3.5 `publish` key is excluded). `PREREQUISITE_FAILED` and
`RUN_ACTIVE` arrive as `ApiFailure` codes carrying the server's `current` object, which the workspace
reads for `actions` and `activeRunId`. Responses are shape-checked like every other call.

## Run list limit (package 3.6)

`runs(signal, jobId?, limit?)` adds `limit` to `GET /api/v1/runs` only when it differs from the
server default of 12 (the server accepts 1 to 50). The Tasks page uses 12 and 50.

## Letter calls (package 3.5)

`letter(id, signal)` GETs `/api/v1/jobs/<id>/letter`; `saveLetter(id, {expectedHash, text}, nonce,
signal)` PUTs it; `startPublish({action: 'publish', jobId, requestKey, expectedHash}, nonce, signal)`
POSTs `/api/v1/runs`; `letterPdfHref(id)` is the inline PDF route. Responses are shape-checked.
`LETTER_CONFLICT` carries `current {text, contentHash}`, and `LETTER_NOT_EDITABLE` and `RUN_ACTIVE` arrive
as `ApiFailure` codes. Types are the generated `LetterResponse`, `LetterPutRequest` and the publish arm of
`RunCreateRequest`.

## Jobs list filters (package 4.3)

`jobs(query, cursor, signal)` sends `scoreMin`, `scoreMax` and `addedWeek` only when set. `filters` now
includes `any`, and `isJobsQuery` accepts the three optional fields in the echoed query (numbers for the score
bounds, a string for the week).

## Provider models (D066)

`isProviderSettings` now requires `models.claude` and `models.codex`, each a list of 1 to 50 non-empty
strings. A response without them is an invalid response.

## Build stamp (F16)

`PAGE_BUILD` is the stamp compiled into the page; `isStaleBuild(serverBuild)` is true only when both stamps
are real times and the service's is older. `session()` remembers the service's `build`, and when the service is
stale an unexpected-response failure carries `STALE_BUILD_MESSAGE` instead of the generic text, so the
banner and the failing card give one cause. `dev` on either side never counts as stale.

## Cost calls (package 4.7)

`costSummary(range)` GETs `/api/v1/cost/summary?range=` and `costCalls(range, limit)` GETs `/api/v1/cost/calls?range=&limit=`. Both are checked for the count fields, `estimatedUsd` (number or null), job and day fields, and `unpriced`; a shape mismatch is an `INVALID_RESPONSE` failure. Types `CostSummary`, `CostTotals`, `CostJobRow`, `CostCall` and `CostRange` come from the generated types.
