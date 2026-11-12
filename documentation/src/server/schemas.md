# src/server/schemas.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE1_CONTRACT.md` and API v1.

Exports `publicSchemas`, a frozen map of standalone JSON Schemas named `HealthResponse`,
`ReadyResponse`, `SessionResponse`, `JobsQuery`, `JobsResponse`, `OverviewResponse`,
`JobDetailResponse`, `JobMaterialParams`, the job write DTOs (`JobStatusRequest`, `JobMetadataRequest`, `JobJdRequest`,
`JobWriteResponse`, `JobJdWriteResponse`), the intake DTOs (`IntakeCheckRequest`, `IntakeCheckResponse`, `IntakeCompaniesResponse`,
`IntakeSubmitRequest`, `IntakePreviewResponse`, `IntakeAddResponse`), `ScanReportResponse`, the provider settings DTOs (`ProvidersSettingsResponse`, `ProvidersPutRequest`,
`ProvidersReadinessRequest`, `ProvidersReadinessResponse`), the run DTOs (`RunCreateRequest`, `RunCreateResponse`,
`RunsResponse`, `RunResponse`, `RunLogResponse`) and `ErrorResponse`. Success schemas use the common `{data,meta:{requestId,observedAt}}` envelope.
`JobsQuery` is the normalized query echo and excludes the opaque cursor. Jobs and overview schemas
define the settled Stage 2.1 closed wire DTOs. `JobDetailResponse` is the closed Stage 2.2 workspace DTO (job plus notes and a boolean evaluation
error, JD, report state, evaluation and status history, listed materials, interview prep);
`JobMaterialParams` documents the `:id` and `:key` route parameters. `ReadyResponse.taskDispatch` is `{ready: boolean, reason: notConfigured | notAvailable | null}`.
`JobDetailResponse` also carries `actions`, the run DTO a `selection`, and the job-action variant of
`RunCreateRequest` an optional `selection` override. The session capabilities are
booleans `jobReads`, `jobDetail`, `jobWrites`, `intake`, `providerSettings` and `taskDispatch` (true only when the browser_runs migration is
applied and run dispatch is wired). The run schemas follow the Stage 3.1 contract: the wire run
hides the pid and log reference, the request allows only `action` (evaluate, cv, letter, both),
`jobId` and `requestKey`. These schemas drive Fastify response validation and
`generate-types.mjs`; frontend wire DTOs must not be handwritten separately.

**Kind:** shared module. JSON Schema objects are serializable and contain no runtime secrets or
private data.

**Stage 3.5 DTOs:** `JobDetail.actions` requires `publish`; `LetterResponse` (name, text, a
64-hex or empty `contentHash`, `pdf` or null, `editable`); `LetterPutRequest` (`expectedHash`, `text`);
and a `publish` variant of `RunCreateRequest` (`jobId`, `requestKey`, `expectedHash`, nothing else).

**Legacy action `both`:** `Run.action` also allows `both`, which only legacy TUI records carry (browser runs never do since 3.1 splits a pair into `cv` and `letter`).
