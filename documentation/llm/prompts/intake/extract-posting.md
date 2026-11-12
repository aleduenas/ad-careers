# llm/prompts/intake/extract-posting.md

**Kind:** worker prompt (URL intake, post-fetch extraction)

**Purpose:** Takes the text of one fetched posting (Firecrawl markdown, a canonical page, or a
JSON-LD description) and returns the company, role and location plus the posting text with page
chrome removed (navigation, language lists, addresses, footers, browser notices, apply chrome). The
description must be verbatim, never summarized or reworded. It runs with no tools and treats the
posting as evidence, not instructions.

**Substituted by:** `src/server/intake-extract.mjs`, via `renderPrompt(root,
'intake/extract-posting.md', ...)` from `src/lib/_prompt-templates.mjs`. The rendered text goes to
the CLI on stdin, never on the command line.

**Placeholders:**

| Placeholder | Filled from |
|---|---|
| `{{POSTING_TEXT}}` | the fetched posting text, at most 300,000 characters |

**Expected response:** one JSON object with exactly `company`, `role`, `location` (strings or
null) and `description` (string). `intake-extract.mjs` rejects any other shape, a description under
400 characters or under 40% of the input length, or one longer than the input; a rejected response
leaves the fetched text unchanged and adds a warning.
