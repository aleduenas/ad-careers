A previous CV-tailoring agent returned text that is not parseable JSON. This is
a fresh repair attempt. Use no tools, searches, or facts outside the
instructions below.

## Original instructions, repeated in full

{{ORIGINAL_PROMPT}}

## Exact parser failure

{{PARSE_ERROR}}

## The previous unparseable response, verbatim

The content below is very likely correct; only its JSON syntax is broken. Reuse
its wording wherever the original instructions allow.

{{PREVIOUS_RESPONSE}}

## Repair task

Return the same JSON object as strictly valid JSON, with exactly the keys of
the previous response in their original order. If the previous response was
only a repaired block of the worksheet, return only that block, not the full
worksheet. Check these syntax rules, which are the usual cause:

- Every line break inside a string value is the two characters `\n`, never a
  real newline. This applies to the cover letter's paragraph breaks.
- Double quotes, backslashes and tabs inside a string value are escaped
  (`\"`, `\`, `\t`). No other control character appears inside a string.
- Every property and string value is wrapped in double quotes, never single
  quotes or backticks.
- No trailing comma before a `}` or `]`, and no comments.

Do not add Markdown, a code fence, commentary, or text before or after the
JSON. Output the JSON object and nothing else.
