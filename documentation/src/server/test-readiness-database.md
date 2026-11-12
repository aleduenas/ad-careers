# src/server/test-readiness-database.mjs

Integration test for the readiness catalog SQL in `src/server/readiness.mjs`. Injected-query tests
cannot detect type errors in that SQL, which is how a `text[] <@ name[]` failure on PostgreSQL 17
reached the owner. Run through `node src/helpers/db-test.mjs` against the disposable
`career_ops_test_` database; without `TEST_DATABASE_URL` it prints SKIPPED and exits 0.

It applies every migration to a throwaway schema and checks four outcomes: the check passes; a SQL
error is `SchemaNotReadyError` with the driver error as `cause`; a renamed required column is
`SchemaNotReadyError` and renaming it back restores readiness; a dead port is
`DatabaseUnavailableError`. The schema is dropped at the end.
