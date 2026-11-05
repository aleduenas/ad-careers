Research current Canadian salary benchmarks and demand for this role using web
search/page retrieval. No company reputation research and never retrieve job
description content. Distinguish CAD, base pay and total compensation; cite
direct URLs with dates. No local files or delegation. Use at most four
searches and four page fetches.

## Role

Company: {{COMPANY}}
Role: {{ROLE}}
Location: {{LOCATION}}
Date: {{DATE}}

## Worksheet

Return EXACTLY AND ONLY the JSON worksheet below. Keep every key, key order,
object, array, and nesting exactly as supplied. Replace only the placeholder
values. Do not add, remove, rename, reorder, or move keys, except that the
`evidence` array may have entries added or removed within its stated limit
and each entry must keep the same `fact`/`date`/`url` shape. Do not return
Markdown, a code fence, explanations, notes, or any text before or after
JSON. Write UNKNOWN for unknown facts and NONE for optional empty text
fields.

Include 0-3 evidence items for the section. Omit an entry entirely rather
than inventing a placeholder fact.

<!-- WORKSHEET_JSON_START -->
{
  "limitations": "REPLACE: describe unavailable evidence, or NONE",
  "sections": {
    "Role market": {
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
