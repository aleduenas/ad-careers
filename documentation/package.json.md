# Node package manifest

**Authority:** [package.json](../package.json).

Defines package identity, a Node.js >=24.0.0 engine, npm command aliases and dependencies. Existing runtime dependencies retain their declared ranges; the browser/API foundation dependencies are exactly pinned: Fastify 5.12.8, React/ReactDOM 19.3.1, Vite 8.3.7, `@vitejs/plugin-react` 6.3.0, TypeScript 7.0.2, React types 19.3.0, Radix dialog 1.3.1, tabs 1.2.1, dropdown-menu 2.2.1, and `json-schema-to-typescript` 16.0.0. The `web:*` aliases cover schema type generation, strict frontend typechecking, production build, loopback development server and local production startup (`web:start`, with `--no-open` for headless use). See the [command reference](guides/SCRIPTS.md) for their outputs and limits. `package-lock.json` pins the resolved dependency tree; dependency installation is separate from browser installation.

