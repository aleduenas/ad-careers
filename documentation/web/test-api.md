# `web/test-api.mjs`

Authority: this Node test module covers the read-only API client with injected fetch responses. It
checks the exact endpoints, GET-only request shape and abort signal, preserves the safe database and
schema error codes, sanitizes network/invalid-response failures, and confirms that cancellation is
not mislabeled as a network outage. It uses only synthetic envelopes and no server or database.
