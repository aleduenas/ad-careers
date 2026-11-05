# infra/docker/compose.yml

**Authority:** [infra/docker/compose.yml](../../../infra/docker/compose.yml).

Defines the local PostgreSQL service.

## Inputs

Requires root `.env` via `db-infra.mjs`; `POSTGRES_PASSWORD` is mandatory and `POSTGRES_PORT` defaults to 54329.

## Outputs and behavior

Runs `postgres:17.6-bookworm`, bound only to 127.0.0.1, with database/user `career_ops`, named `postgres-data` volume and `pg_isready` healthcheck. Restart policy is `unless-stopped`.

## Dependencies and callers

Used by `src/helpers/db-infra.mjs` for lifecycle, backup and restore. Start through `npm run db:up`; schema migrations are a separate command.

