# src/server/generate-types.mjs

**Authority:** generated declarations derive from `publicSchemas` in
`src/server/schemas.mjs`.

Runs the pinned `json-schema-to-typescript` compiler and writes the combined API declarations to
`web/src/generated/api.d.ts`. It imports the canonical repository root from `src/lib/root.mjs`.
The generated declaration is ignored build output; edit the server
schemas and regenerate instead of changing the declaration manually. This script runs directly as
`node src/server/generate-types.mjs` and is also the `web:types` package command.

**Kind:** generator script. It writes only the ignored generated type file, never runtime or
candidate data.
