# Frontend TypeScript configuration

**Authority:** [web/tsconfig.json](../../web/tsconfig.json).

Enables strict, no-emit type checking for the browser application under `web/src`, with ES2022,
DOM and React's automatic JSX runtime. TypeScript uses bundler module resolution and Vite client
types. `npm run web:typecheck` first regenerates the API types from backend schemas, then runs the
compiler. The generated `web/src/generated/api.d.ts` file is ignored build output.
