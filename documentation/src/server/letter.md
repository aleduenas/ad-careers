# src/server/letter.mjs

**Authority:** `documentation/dashboard-migration/design/STAGE3_LETTER_CONTRACT.md`.

Letter editing for Stage 3.5. `createLetterService({ query, resolveMaterials, rootDir, fs })`
returns a frozen `{ read, save, pdf, snapshot, exclusive }`. Defaults use the shared pool, the
materials resolver and the real file system; all adapters can be injected. The service reads and
writes exactly one file: `cover-letter.md` in the job's matched output folder. Saving never starts
a run and never renders a PDF.

**Which file.** The job row comes from the same query the detail reader uses. The matched folder
must be an `id` or `legacy` match with a single candidate (an ambiguous or missing match is 404),
the resolver's preferred letter must be named exactly `cover-letter.md` (a draft, a brief or a PDF
alone is not editable, and nothing is ever created), and the file is re-checked with
`inspectSafeFile` under `output/` (symbolic links and escapes are 404).

**read(id)** returns `{ name, text, contentHash, pdf, editable }`. `contentHash` is the sha256 hex
of the file bytes; `pdf` is `{ name, modifiedAt }` when `cover-letter.pdf` sits in the same folder.
A file above 256 KB or that is not valid UTF-8 is listed with `editable: false`, empty `text` and
empty `contentHash`.

**save(id, { expectedHash, text })** validates the body (a 64-character lower-case hex hash, text
that is non-blank, at most 256 KB of UTF-8 after normalizing, CRLF and lone CR turned into LF, and
no control character other than tab and newline; 400 `INVALID_REQUEST` with `fields.text`), then
runs inside the service mutex: 409 `RUN_ACTIVE` with `error.current.activeRunId` while a `letter`
or `publish` run for the job is queued or running (a missing `browser_runs` table means none),
409 `LETTER_NOT_EDITABLE` for an oversized or non-UTF-8 file, and 409 `LETTER_CONFLICT` with
`error.current: { text, contentHash }` when the file hash differs from `expectedHash`. Text equal
to the current text after line-ending normalization is a no-op (no write, same mtime). Otherwise
the text is written to a temporary file in the same folder (`wx`), the hash is checked once more
immediately before the swap, and `rename` replaces the letter; any failure removes the temporary
file and leaves the original, and a driver or disk message never reaches the wire.

**pdf(id)** returns `{ name, size, stream() }` for the published `cover-letter.pdf` of the matched
folder (404 otherwise). The materials list prefers `cover-letter.md` for the letter key, so the
inline PDF is served from here (`GET /api/v1/jobs/:id/letter/pdf`).

**snapshot(id)** returns `{ path, editable, text, contentHash }` (the absolute real path) or null.
The run service uses it to compare the hash and to build the publish argv. **exclusive(fn)** is the
mutex shared with the publish dispatch, so a save cannot land between the hash check and the run
row.

**Tests:** `node --test src/server/test-letter.mjs`; the real SQL path is covered by
`test-runs-service-database.mjs` and the real render by `reviews/3.5/smoke/run-smoke.mjs`.
