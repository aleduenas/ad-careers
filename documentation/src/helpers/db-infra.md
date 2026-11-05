# src/helpers/db-infra.mjs

**Kind:** admin command
**Purpose:** Thin wrapper around `docker compose` for the PostgreSQL container defined in `infra/docker/compose.yml`. It creates the private `.env`, starts and stops the service, shows status, takes custom-format `pg_dump` backups and restores a dump into a new, explicitly named database. It exists so nobody has to remember the compose file and env-file flags.

## Run
`node src/helpers/db-infra.mjs <action>`:
- `init`: create `.env` with a random 32-byte `POSTGRES_PASSWORD` and `POSTGRES_PORT=54329`; refuses if `.env` exists
- `up`: `docker compose up -d --wait` (alias `npm run db:up`)
- `down`: `docker compose down` (alias `npm run db:down`)
- `status`: `docker compose ps`
- `config`: `docker compose config --quiet` (validates the compose file)
- `backup [FILE]`: `pg_dump -Fc` into `FILE` or `data/backups/career-ops-<timestamp>.dump` (alias `npm run db:backup`)
- `restore FILE career_ops_restore_NAME`: `createdb` then `pg_restore --exit-on-error` into that new database only

## Reads
- `.env` (passed to compose as `--env-file`), `infra/docker/compose.yml`
- Environment: `LOCALAPPDATA`, `ProgramFiles` to locate `docker.exe` (falls back to `docker` on PATH)
- The dump file given to `restore`

## Writes
- `.env` (`init`, `wx` flag so it never overwrites)
- `data/backups/*.dump` (`backup`): written to `<file>.partial` then renamed; a partial file is deleted on failure; refuses to overwrite an existing dump
- PostgreSQL: a new database named `career_ops_restore_*` (`restore`)

## Imports
- `src/lib/_database.mjs` (`root` only)

## Used by
- `package.json` scripts `db:up`, `db:down`, `db:backup`
- `src/helpers/db-cutover.mjs` (`up`, `backup`)

## Notes
- All commands run inside the container via `docker compose exec -T postgres`, so no local PostgreSQL client is needed.
- `restore` validates the target name with `/^career_ops_restore_[a-z0-9_]+$/`; restoring over the live `career_ops` database is impossible through this command.
- Any non-zero Docker exit throws "Docker command failed: <status>".
