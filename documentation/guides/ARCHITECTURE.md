# Architecture

The Go dashboard and Node workflow scripts connect to the same local PostgreSQL server. Docker Compose defines its network binding, health check and durable volume. See [database operations](database.md).

```text
Public discovery / pasted JD → cached JD → PostgreSQL jobs
                                          ↓
                              eligibility + research + evaluation
                                          ↓
                          immutable report → completion transaction
                                          ↓
                                 dashboard / analytics
```

The jobs table is the sole application-state record. PostgreSQL generates permanent IDs and enforces unique normalized posting URLs. Status transitions carry an expected revision, and successful writes append audit history. Evaluations have unique completion keys, making retries safe. A manual status change is preserved when evaluation finishes later.

Workflow leases are scoped to individual jobs; unrelated jobs can proceed concurrently. Company research uses its own lease because its cache is shared. CV generation retains per-output-folder locks. The dashboard refreshes after operations and periodically; database errors are shown without clearing the previous view.

Readable JD files remain in data/jds/, with exact content synchronized into job_descriptions by permanent job ID. Evaluation, drafting by ID and the dashboard JD viewer read PostgreSQL. Research, reports and generated application documents remain files. Reports publish before their database references, so interrupted publication is recoverable on retry. Only the migration importer understands retired storage formats. Its audit, backups and record comparison precede cutover.

Provider behavior, cached-JD policy, scoring and CV worksheet contracts are unchanged. Public hiring.cafe discovery still stops live requests on the first 403/429, uses eligible cached results, and requires the full canonical JD before accepting a job.
