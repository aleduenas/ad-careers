# src/server/schemas.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE1_CONTRACT.md` and API v1.

Exports `publicSchemas`, a frozen map of standalone JSON Schemas named `HealthResponse`,
`ReadyResponse`, `SessionResponse`, `JobsQuery`, `JobsResponse`, `OverviewResponse`, and
`ErrorResponse`. Success schemas use the common `{data,meta:{requestId,observedAt}}` envelope.
`JobsQuery` is the normalized query echo and excludes the opaque cursor. Jobs and overview schemas
define the settled Stage 2.1 closed wire DTOs. The session capability schema allows boolean
`jobReads`; the current handler still returns false until both routes are implemented.
`taskDispatch` remains false. These schemas drive Fastify response validation and
`generate-types.mjs`; frontend wire DTOs must not be handwritten separately.

**Kind:** shared module. JSON Schema objects are serializable and contain no runtime secrets or
private data.
