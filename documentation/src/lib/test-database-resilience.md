# src/lib/test-database-resilience.mjs

Regression test for F29, where a PostgreSQL restart crashed the dashboard with an unhandled `error`
event. The offline part always runs: errors emitted on the pool and on a client must not throw, are
logged once per outage and never print the message or any connection string. The live part runs
through `node src/helpers/db-test.mjs` against the disposable `career_ops_test_` database and is
skipped without `TEST_DATABASE_URL`: it terminates an idle pooled backend, an in-flight query and
a transaction's backend with `pg_terminate_backend`, and asserts the process survives and the next
query succeeds each time.
