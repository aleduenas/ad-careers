# src/lib/test-llm-prices.mjs

**Kind:** synthetic Node test suite for `src/lib/llm-prices.mjs`. Run with `node --test
src/lib/test-llm-prices.mjs`. Covers the disjoint-bucket formula (reasoning never double counted),
null for an unpriced model and 0 for no tokens, a missing file (empty, no error), unreadable and
invalid files (empty with a generic code, no path or text), a byte-order mark, dropped extra
fields, and validation of duplicates, providers, sources and version. No files or network. It also covers `findPrice` suffix matching and the `longContext` tier (validation and selection per call). Also covered: the shipped defaults used only when the config file is absent, a broken config never replaced, date-suffix-only model matching, the 1-hour Claude cache write rates, and the example file pricing every listed model id.
