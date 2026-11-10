# `web/src/api.ts`

Authority: this module is the frontend read-only API client. Its only endpoints are the generated
`HealthResponse`, `ReadyResponse`, and `SessionResponse` contracts at `/api/v1/health`,
`/api/v1/ready`, and `/api/v1/session`. It accepts an injected `fetch` implementation for isolated
tests, forwards abort signals, and maps safe server errors and network failures into `ApiFailure`.
The generated declarations in `web/src/generated/api.d.ts` remain the wire-type authority. The
client never exposes session nonces in its errors or presentation.
