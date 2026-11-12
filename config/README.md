# config/

Private except this README and `examples/`. Two kinds of file live here:

**Candidate documents** (full-size, human-readable; the LLM workers get compact twins under `llm/compacted/`):

| File | Compact twin | Notes |
|---|---|---|
| `profile.md` | `llm/compacted/candidate-targeting.md` | Who the candidate is, what they target, comp, location, negotiation, evaluation rulings. Both carry a sync rule: change one, change the other in the same edit |
| `cv.md` | `llm/compacted/cv-compact.md` | Canonical CV; the renderer (`src/cvgen/_cv-content.mjs`) reads this one, the CLI workers read the compact twin |
| `cv-guidance.md` | — | CV presentation guardrails (reference; not loaded by scripts) |

**Runtime settings** (read by the backend):

| File | Read by |
|---|---|
| `profile.yml` | `src/cvgen/_cv-content.mjs` (contact block in the rendered CV) |
| `portals.yml` | `src/scan/scan.mjs`, `src/helpers/verify-portals.mjs` (which companies to scan, title filters) |
| `cv-drafting.json` | drafting launchers load it and pass provider settings to `src/lib/cli-runtime.mjs`; `src/eval` borrows the executable paths |
| `cv-content-policy.json` | `src/cvgen/_cv-content.mjs` (catalog rules) |
| `evaluation-cli.json` | optional evaluator overrides (absent means code defaults) |
| `database-import.json` | legacy import recovery only |
| `firecrawl.json` | `src/server/intake-fetch.mjs` (optional Firecrawl key for URL intake of LinkedIn, Indeed and JavaScript-only postings) |

`examples/` holds current starting points for `profile.yml`, `portals.yml`, `cv-drafting.json`,
`cv-content-policy.json` and optional `evaluation-cli.json` and `firecrawl.json`. Remove `.example` from copied names;
replace policy placeholders and configure authorized models before generation.

`firecrawl.json` is `{ "version": 1, "apiKey": "fc-..." }`; the `FIRECRAWL_API_KEY` environment variable overrides it. The key is read on every fetch (no restart needed), is sent only to Firecrawl in an Authorization header, and is never logged or returned. Only the posting URL is sent. Without it, URL intake still works for postings the scanner's resolver can read.

`llm-prices.json` is optional: `{ "version": 1, "prices": [ { "provider", "model", "inputUsdPerMtok", "cachedInputUsdPerMtok", "cacheWriteUsdPerMtok", "outputUsdPerMtok", "source" } ] }`, USD per million tokens, read by `src/lib/llm-prices.mjs` for the Cost page's API-price view. Without this file the shipped `examples/llm-prices.example.json` (public prices fetched 2026-11-12, each entry citing its page) is used; a present file replaces it entirely, so copy the example and edit it when prices change (no restart needed). An invalid file is an error on the Cost page, never a silent fallback. A model without an entry shows as unpriced, never as zero cost.
