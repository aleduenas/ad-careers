# src/server/test-intake-extract.mjs

**Kind:** synthetic Node test suite for `src/server/intake-extract.mjs`. Run with `node --test
src/server/test-intake-extract.mjs`. The CLI runner, temporary worker and config reads are
injected; no model is called.

Cases: default claude / haiku and the `functions.intake` override (invalid entries ignored); a valid
answer with the posting text on stdin only and nothing in argv; override model and command reach the
call; fenced JSON and null fields; every invalid-answer branch (not JSON, wrong or extra keys,
description not a string, too short, under 40% of the input, longer than the input, non-string
field) discarded with the fixed warning; CLI failures, bad envelopes and spawn errors giving the
failed warning without leaking output; empty and oversized input never reaching the model; field
bounds; and the real prompt template rendering with the posting placeholder.

Verbatim check: markdown-marker and link differences pass, a verbatim subset passes, a reworded description and one padded with invented sentences are discarded, and `verbatimShare` returns 1 for a copy and 0 for unrelated text.
