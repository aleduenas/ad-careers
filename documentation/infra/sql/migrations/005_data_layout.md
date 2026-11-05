# infra/sql/migrations/005_data_layout.sql

**Authority:** [infra/sql/migrations/005_data_layout.sql](../../../../infra/sql/migrations/005_data_layout.sql).

Rewrites stored artifact paths for the repository data-directory move.

## Inputs

Matches old `reports/` and `jds/` prefixes in job/evaluation/JD rows.

## Outputs and behavior

Rewrites report paths to `data/evaluations/` and JD paths to `data/jds/`. It moves no physical files and does not change JD/report contents.

## Dependencies and callers

Applied by `db-migrate.mjs` after coordinating the filesystem move and backup. Verify references with `node src/helpers/verify-pipeline.mjs`. Applied migration is immutable.

