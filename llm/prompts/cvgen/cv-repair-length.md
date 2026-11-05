A previous CV-tailoring agent produced a worksheet that rendered too long. This
is one fresh repair attempt. Use no tools, searches, or facts outside the
instructions below.

## Original instructions, repeated in full

{{ORIGINAL_PROMPT}}

## Previous response

This is the previous agent's complete worksheet. It passed validation, but the
rendered PDF came out to {{PAGE_COUNT}} pages against a {{MAX_PAGES}}-page
limit.

{{PREVIOUS_RESPONSE}}

## Repair task

Return a revised worksheet that fits within {{MAX_PAGES}} pages. Cut length,
do not add it: shorten or drop bullets, drop an optional (non-required) role
entirely if it no longer earns its space, tighten the summary, or drop a
project only if three remain. Do not invent facts, do not restore anything
the original instructions or customization plan said to trim, and do not
change wording that was not required to shorten it. Keep every experience,
project and skill key from the worksheet, using an empty array or empty
string for anything you drop entirely.

Return EXACTLY AND ONLY the full worksheet as one JSON object with the same
keys and nesting as the original instructions describe. Do not add Markdown,
a code fence, commentary, or text before or after the JSON.
