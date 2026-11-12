# src/server/test-intake-fetch.mjs

**Kind:** synthetic Node test suite for `src/server/intake-fetch.mjs` and its route in `app.mjs`.
Run with `node --test src/server/test-intake-fetch.mjs`. Resolver, page fetch, Firecrawl HTTP, DNS
and the key file are all injected; no live request, no real key.

Cases: resolver path (Greenhouse text plus JSON-LD fields, JSON-LD page with remote type, `@graph`
and array forms, malformed blocks); ATS JSON fields (and gaps completed from JSON-LD); Firecrawl fallback on empty resolver; excluded hosts go straight to Firecrawl; the request
shape (v2 endpoint, bearer header, no key in the body, only the URL sent); environment key wins over
the file; not configured or invalid key file is named in the 422 hint when nothing else is readable;
401, 402, 429, 5xx, network error, unreadable reply and `success: false` give 502 without the key
or Firecrawl's body; empty scrape; resolver budget cutoff; 1 MB cap; URL validation (loopback,
localhost, private, link-local, IPv6 forms, decimal IP, DNS rebinding to a private address,
login, non-http) before any request; strict body; the route's write guard, 503 without a service,
and error mapping.

Extraction cases (the extractor is injected): fields fill nulls only, the description replaces the
text and the method gains `+llm`; a discarded or failed extraction keeps the text and adds the
warning; ATS results skip the step and every other source runs it; resolver text with missing
fields does not spend a Firecrawl credit; the Firecrawl request asks for markdown only.
