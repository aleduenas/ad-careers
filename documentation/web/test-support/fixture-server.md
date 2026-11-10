# `web/test-support/fixture-server.mjs`

Authority: this opt-in browser QA fixture starts the accepted backend app factory at the reserved
loopback API address. It requires an explicit `CAREER_OPS_FIXTURE_MODE` of `ready`, `db-down`,
`schema-not-ready`, or `delayed`; readiness is always injected and never falls back to the real
catalog/database adapter. Port collisions are reported without stopping an existing process. It is
for synthetic development/browser checks only and is not the production startup path.
