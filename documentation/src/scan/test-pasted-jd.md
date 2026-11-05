# Pasted-JD validation tests

**Authority:** [src/scan/test-pasted-jd.mjs](../../../src/scan/test-pasted-jd.mjs).

Run node src/scan/test-pasted-jd.mjs; also discovered by the quick suite. Checks frontmatter
and byte-preserved body, URL normalization, unsupported/invalid URLs and CLI rejection of
short descriptions before database access. Uses synthetic inputs and Node child processes;
no network or database is required. The module import may create the empty data directory.

The isolated [drafting acceptance test](../cvgen/test-drafting-integration.md) additionally
covers canonical company spelling, duplicate rejection, dry-run and actual ingestion.
