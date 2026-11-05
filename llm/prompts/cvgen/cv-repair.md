A previous CV-tailoring agent messed up the worksheet validation. This is one
fresh repair attempt. Use no tools, searches, or facts outside the instructions
below.

## Original instructions, repeated in full

{{ORIGINAL_PROMPT}}

## Previous response

This is the previous agent's complete worksheet. Everything outside the block
below already passed validation and is kept as is; do not return it.

{{PREVIOUS_RESPONSE}}

## Exact validation failure(s)

{{VALIDATION_ERRORS}}

## Block to repair

These are the only sections of the previous response that failed validation,
nested exactly as they appear in the worksheet. A `null` value means the
previous response left that entry out; fill it as the original instructions
describe.

{{AFFECTED_JSON}}

## Repair task

Fix the block above so it satisfies every validation failure listed and the
original instructions. The candidate CV in the original instructions remains
the sole source of candidate facts. Keep the rest of the previous response in
mind so the fixed block does not repeat facts already used elsewhere.

Return EXACTLY AND ONLY the fixed block as one JSON object with the same keys
and nesting as the block above. Do not return the rest of the worksheet. Do not
add Markdown, a code fence, commentary, or text before or after the JSON.
