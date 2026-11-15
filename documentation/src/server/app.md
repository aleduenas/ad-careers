# src/server/app.mjs

**Authority:** this module defines the HTTP boundary; response contracts are in
`documentation/dashboard-migration/design/STAGE1_CONTRACT.md` and
`documentation/dashboard-migration/design/STAGE2_READ_CONTRACT.md`.

**Kind:** shared module. `createApp()` returns an unlistened Fastify app and accepts injected
readiness, `jobsReader`, `jobDetailReader`, `runsService`, `jobsWriter`, `ghosting`, `intakeService`, `intakeFetchService`, `providersService`, `costService`, loopback host/origin, development mode, nonce, owned-resource closer and
an optional production static handler. Importing the module does not start a listener.

**Routes (all GET, read-only):** `/api/v1/health`, `/api/v1/ready`, `/api/v1/session`,
`/api/v1/jobs`, `/api/v1/overview`, `/api/v1/jobs/:id` and `/api/v1/jobs/:id/materials/:key`. `/jobs` accepts only `q`, `filter`, `sort`, `direction`, `scoreMin`, `scoreMax`, `addedWeek`,
`grouped`, `limit` and `cursor`, each at most once; values are validated by `normalizeJobsQuery()`
and a bad value or stale cursor returns 400 `INVALID_REQUEST` with the offending name in `fields`.
`/overview` returns the inferred counts and progress block. The session carries `build`, the `buildStamp` option (default `'dev'`; `start.mjs` passes the ISO mtime of `web/dist/index.html` computed once at startup), so the page can detect a stale server. The session reports
`capabilities.jobReads` and `capabilities.jobDetail` true because these reads exist; `taskDispatch` stays false.

`/jobs/:id` returns the workspace detail from `jobs-detail.mjs`. The materials route serves the
listed file for `cv`, `letter`, `brief` or `prep`: text as `text/plain; charset=utf-8` (HTML never
renders) and PDF inline with a sanitized `Content-Disposition` filename and a relaxed CSP
(`frame-ancestors 'none'; base-uri 'none'`) so the browser's PDF viewer can open it. Param
validation, 404s and the file lookup live in the reader; the route passes the raw params.

**Runs (Stage 3.1):** `POST /api/v1/runs` (the only write route) dispatches an `evaluate`, `cv`,
`letter` or `both` run through `runs.mjs`: 201 for a new run, 200 when the same `requestKey` and
body replay an existing one, 409 `REQUEST_KEY_CONFLICT` otherwise. It requires the session nonce
header and a JSON content type (`requireSessionNonce`, checked before the body is read), and the
body is schema-validated with no extra fields. `GET /api/v1/runs` (optional `jobId`),
`GET /api/v1/runs/:id` and `GET /api/v1/runs/:id/log` (optional `offset`) read runs and a
bounded, redacted log tail. Run reads accept only those query parameters, once each. Without a
run service the run routes return 503 `TASKS_UNAVAILABLE` and the session reports
`taskDispatch: false`; with one, `taskDispatch` is true only when the `browser_runs` migration is
applied. `GET /ready` reports the same truth as `taskDispatch: { ready, reason }`, where `reason` is
`notConfigured` (no service), `notAvailable` (migration absent or unreadable) or null. The default service exists only with the default readiness check (production), starts
its 30 s reconcile on `listen`, and stops on close; injected services are never started or
owned by the app, and `runsService: null` disables runs.

**Job writes (Stage 3.2):** `POST /api/v1/jobs/:id/status`, `PATCH /api/v1/jobs/:id/metadata` and
`PUT /api/v1/jobs/:id/jd` call `jobs-write.mjs`. All three go through the write guard (session nonce
header and JSON content type, checked before the body is read, no query string). Bodies are capped
at 16 KB, and 4 MB for the JD route (text at most 2 MB). Conflicts are 409 `REVISION_CONFLICT`,
`FIELD_CONFLICT`, `URL_IN_USE` or `JD_CONFLICT` with the current state in `error.current`. The
session reports `jobWrites`: the default writer exists only with the default readiness check, an
injected writer counts as available, and `jobsWriter: null` disables writes (503
`WRITES_UNAVAILABLE`). The hourly Ghosted scheduler (`ghosting.mjs`) is created only with the default
readiness and no injected reader, starts on `listen` and stops on close.

The material route also accepts an optional trailing filename (`/jobs/:id/materials/:key/:filename`)
that must equal the resolved file name, else 404, so the browser tab shows the name.

**Intake and scans (Stage 3.3):** `POST /api/v1/intake/check`, `/intake/preview` and `/intake` go
through the write guard and call `intake.mjs` (bodies up to 4 MB, 8 KB for check);
`POST /api/v1/intake/fetch` (D080, package 4.6; 8 KB body, same write guard) calls `intake-fetch.mjs` and returns `IntakeFetchResponse`; it is created only with the default intake service (an injected `intakeService` means none unless `intakeFetchService` is injected) and `null` gives 503 `INTAKE_UNAVAILABLE`. `GET /api/v1/intake/companies?q=` is a read. `POST /runs` also accepts the scan variant, and
`GET /api/v1/runs/:id/scan-report` serves the projected report. The session reports `intake`: the
default service exists only with the default readiness check, an injected service counts as
available, `intakeService: null` disables it (503 `INTAKE_UNAVAILABLE`). One discovery lock is
shared by the default run and intake services.

**Provider settings (Stage 3.7):** `GET /api/v1/settings/providers`, `PUT
/api/v1/settings/providers/:function` and `POST /api/v1/settings/providers/readiness` (body `{}`) call
`providers.mjs`; the two writes go through the write guard (bodies at most 4 KB and 1 KB). The
session reports `providerSettings`: the default service exists only with the default readiness check
(it reads and writes private config), an injected service counts as available, and
`providersService: null` disables it (503 `SETTINGS_UNAVAILABLE`). The default run service resolves
its launcher flags from the same provider service.

**Cost (4.7):** `GET /api/v1/cost/summary` and `GET /api/v1/cost/calls` call `cost.mjs`; they are read routes with strict query validation (`range`, `jobId`, `limit`, `estimates`). The session reports `cost`: the default service exists only with the default readiness check, an injected service counts as available, `costService: null` disables it (503 `COST_UNAVAILABLE`).

**Dispatch rules (Stage 3.4):** `POST /api/v1/runs` for evaluate, cv, letter and both accepts the
optional `selection` override and answers failed prerequisites with 409 `PREREQUISITE_FAILED`
(`error.current.actions`) and an active run with 409 `RUN_ACTIVE` (`error.current.activeRunId`). The
default run service gets its prerequisite checks from the job detail reader (`actionsFor`), so
the detail route and the dispatch always apply the same rules. Runs on the wire carry `selection`.

**Guards:** the Host must be one of two explicit aliases for the configured port, `127.0.0.1:<port>` or `localhost:<port>`, computed once from the configured host; the Origin may be the matching `http://` form of either. Other names (including `localhost.evil.test`), other ports and forwarded headers are 403, the server still listens only on 127.0.0.1, and the session origin and printed URL stay 127.0.0.1. `Forwarded`, `X-Forwarded-*`, unexpected
Origin, cross-site fetch metadata and preflight are rejected. Development mode adds only the
documented Vite origin. Only the jobs and run-read routes may carry query parameters; every other `/api` route
rejects them, and request bodies are rejected on every `/api` route except the run, job write and
intake routes. The run reads, `intake/companies` and `jobs` accept their documented parameters. Static page and
not-found paths ignore query strings so a reload with URL state serves the page. JSON bodies
are bounded to 1 MiB.
Responses are no-store with restrictive security headers, and errors use safe public codes
(database and schema failures map to retryable 503s, never raw driver text).
`requireSessionNonce()` is a guard for future JSON writes; no write route is installed.
Unknown `/api` paths stay in the JSON error envelope; other misses go to the static handler when
one was injected.

**Pool ownership:** `jobsReader` and `jobDetailReader` default to `createJobsReader()` and
`createJobsDetail()` (lazy PostgreSQL pool). The closer runs on `close()` unless `readiness` and
both readers were injected, so injected
test doubles never open or close the default pool.

**Imports:** Fastify, Node crypto, `../lib/_database.mjs`, `./jobs-read.mjs`, `./jobs-detail.mjs`, `./readiness.mjs`,
`./schemas.mjs`.

**Tests:** `node --test src/server/test-app.mjs` uses injected readiness and reader doubles and
synthetic headers; it does not connect to PostgreSQL or read private files. Runtime smokes are at
`documentation/dashboard-migration/reviews/2.1/smoke/run-smoke.mjs` and `.../2.2/smoke/run-smoke.mjs`.

**Letter (Stage 3.5):** `createApp({ letterService })` (default: the real service, only with the
default readiness check; fixture servers inject one or pass null). `GET /api/v1/jobs/:id/letter`
returns the editable `cover-letter.md` state; `PUT` (session nonce and JSON content type, body
limit 2 MB so 256 KB of JSON-escaped text fits) saves it with the hash guard, and
`GET /api/v1/jobs/:id/letter/pdf` serves the published `cover-letter.pdf` inline with the same
headers as the materials PDF route. Without a letter service all three are 503 `WRITES_UNAVAILABLE`.
Conflicts reach the wire as 409 `LETTER_CONFLICT` with `error.current` and 409 `RUN_ACTIVE`. The run
service receives the same letter service for the `publish` action. See `letter.md`.

**Also (3.6):** `GET /api/v1/runs` accepts `limit` (terminal rows, default 12, 1 to 50, else 400 `fields.limit`).

**3.4 Lows:** the default run service requires a detail reader with `actionsFor()`; construction throws otherwise.
