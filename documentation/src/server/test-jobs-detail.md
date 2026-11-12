# src/server/test-jobs-detail.mjs

**Kind:** synthetic Node test suite for `src/server/jobs-detail.mjs` and the detail resolver in
`jobs-materials.mjs`.

Run with `node --test src/server/test-jobs-detail.mjs`. An in-memory `query` returns fixture rows
and asserts every statement is a SELECT with the job ID as the only bound parameter. A temporary
repository root stands in for `data/` and `output/`. Cases: ID and key validation (zero, leading
zero, non-digits, 20 digits, bigint overflow, unknown job); notes, boolean evaluation error and no
private paths for every status; null score and dates and inferred history with null `occurredAt`;
JD present and absent; report `ok`, `missing`, `invalid` (oversize, bad UTF-8) and `unsafe`
(escape, absolute path, wrong root, symlink where the platform allows one); every preferred
material order (CV pdf before html, letter md, pdf, html, draft, brief), ID, legacy, none and
duplicate-ID ambiguity; interview prep exact, fuzzy, none and non-Interview; material text and PDF
serving, oversize rejection, unlisted keys and a symlinked material; database error mapping with
no driver text. The `actions` block is tested for each status, JD and report combination, with every
score value (no effect), active runs per action and for a pair, precedence of prerequisites, a
failing active-run query and `actionsFor`. No database, personal files or network are used.

Stage 3.5 case: `actions.publish` for no letter, a draft, a PDF or a brief alone, the exact file,
the size cap, an existing PDF, status and score independence, active publish and letter runs, other
active runs, and the base block.

Evaluate is enabled for Pending and Evaluated jobs and disabled for every other status.
