Research only this employer and the two sections below. Use web search and
page retrieval, at most four searches and four page fetches. Never retrieve
job descriptions. Cite direct source URLs and dates, distinguish anecdotes,
and disclose uncertainty. Never infer no layoffs from no results. No local
files, candidate assessment, or delegation.

## Employer

Company: {{COMPANY}}
Employer URLs: {{EMPLOYER_URLS}}
Date: {{DATE}}

## Existing cache (may already cover one section; refresh both anyway)

{{EXISTING_CACHE}}

## Worksheet

Return EXACTLY AND ONLY the JSON worksheet below. Keep every key, key order,
object, array, and nesting exactly as supplied. Replace only the placeholder
values. Do not add, remove, rename, reorder, or move keys, except that an
`evidence` array may have entries added or removed within its stated limit
and each entry must keep the same `fact`/`date`/`url` shape. Do not return
Markdown, a code fence, explanations, notes, or any text before or after
JSON. Write UNKNOWN for unknown facts and NONE for optional empty text
fields.

Include 0-3 evidence items per section. Omit an entry entirely rather than
inventing a placeholder fact.

<!-- WORKSHEET_JSON_START -->
{
  "limitations": "REPLACE: describe unavailable evidence, or NONE",
  "sections": {
    "Company Reputation & Culture": {
      "evidence": [
        {
          "fact": "REPLACE: one finding, at most 35 words; distinguish employee anecdotes",
          "date": "REPLACE: actual source precision — YYYY, YYYY-MM or YYYY-MM-DD; UNKNOWN if undated; accessed YYYY-MM-DD only if actually retrieved then; never invent precision",
          "url": "REPLACE: direct http(s) source URL"
        }
      ]
    },
    "Layoffs & Hiring Signals": {
      "evidence": [
        {
          "fact": "REPLACE: one finding, at most 35 words; distinguish employee anecdotes",
          "date": "REPLACE: actual source precision — YYYY, YYYY-MM or YYYY-MM-DD; UNKNOWN if undated; accessed YYYY-MM-DD only if actually retrieved then; never invent precision",
          "url": "REPLACE: direct http(s) source URL"
        }
      ]
    }
  }
}
<!-- WORKSHEET_JSON_END -->
