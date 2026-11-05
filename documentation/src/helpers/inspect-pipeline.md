# src/helpers/inspect-pipeline.mjs

**Kind:** admin command
**Purpose:** Read-only inspection of the pipeline: dumps all jobs or one job from PostgreSQL as JSON, or lists the cached JD files under `data/jds/` grouped by company. It is the documented way for a person or an agent session to look at records without writing ad-hoc SQL.

## Run
`node src/helpers/inspect-pipeline.mjs <command>` (alias `npm run inspect -- <command>`):
- `jobs` (or `status`): `SELECT * FROM jobs ORDER BY id` as pretty JSON
- `job ID`: the single row with that permanent ID (empty array if unknown)
- `cache`: directory listing of `data/jds/<company>/*.md` with counts
- no or unknown command: usage text; exit 1 for an unknown command, 0 for none

## Reads
- PostgreSQL: `jobs`
- `data/jds/` (directory listing only)

## Writes
- none

## Imports
- `src/lib/_database.mjs` (`query`, `close`)

## Used by
- `package.json` script `inspect`
- Referenced by name in `AGENTS.md` as the record-inspection command

## Notes
- Observation: `existsSync` and `readdirSync` are imported from `"fs"` and `join` from `"path"` (no `node:` prefix); harmless but inconsistent with the rest of `src/`.
