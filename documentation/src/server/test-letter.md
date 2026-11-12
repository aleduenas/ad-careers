# src/server/test-letter.mjs

Unit tests for `letter.mjs`, run with `node --test src/server/test-letter.mjs`. Every case uses a
temporary repository root with `output/Acme/data-engineer--7/` and a stub for the job and active-run
queries; the real `output/` is never touched.

Covered: the validation matrix (blank, byte cap, each control character, CRLF and lone CR); read
with the sha256 of the bytes and the PDF; only the exact `cover-letter.md` of an `id` or `legacy`
match is a letter (a draft, a PDF or a brief alone, an ambiguous match and an unknown job are 404
and nothing is written); a file over the cap or not UTF-8 is not editable; the atomic save and its
returned hash; the hash guard and the `LETTER_CONFLICT` shape; unchanged text as a no-op (no write,
same mtime, also for CRLF); a failing swap leaving the original and no temporary file with a safe
error; a change made between the guard and the swap as a conflict; containment (a folder outside
`output/`, and a symbolic-link letter, which is skipped where links cannot be created); the
active-run refusal for `letter` and `publish` only; safe database errors; `snapshot`, `exclusive`
ordering and `pdf`.
