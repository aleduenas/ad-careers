# config/examples/firecrawl.example.json

**Authority:** [config/examples/firecrawl.example.json](../../../config/examples/firecrawl.example.json).

Optional Firecrawl key for URL intake.

## Run and callers

Copy to `config/firecrawl.json` and replace the placeholder with a real key. `src/server/intake-fetch.mjs` reads it on every fetch, so no restart is needed. The `FIRECRAWL_API_KEY` environment variable overrides the file.

## Inputs

`version` (must be 1) and `apiKey` (a `fc-...` key). Without the file, URL intake still works for postings the scanner's resolver can read; LinkedIn, Indeed and JavaScript-only pages then return a warning.

## Behavior and outputs

The key is sent only in the Authorization header of the Firecrawl scrape call. It is never logged, returned or placed on a command line. `config/firecrawl.json` is private and gitignored.
