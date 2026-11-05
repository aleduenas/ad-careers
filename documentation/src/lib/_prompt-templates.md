# src/lib/_prompt-templates.mjs

**Kind:** shared module
**Purpose:** Loads prompt files from `llm/prompts/` and substitutes `{{UPPER_CASE}}` placeholders, failing loudly on any missing template key. It also extracts the literal worksheet JSON a prompt embeds between marker comments and checks that a model's answer preserves that worksheet's key structure, so the prompt file stays the single source of truth for a worksheet's shape.

## Run
Not runnable; imported by other modules.

## Reads
- `llm/prompts/<name>` where `name` is a validated relative path such as `eval/gate.md` or `runtime/no-tools.md` (letters, digits, `/`, `-`, must end in `.md`, no `..`)

## Writes
- none

## Imports
- none (Node built-ins only)

## Used by
- `src/lib/cli-runtime.mjs` (`renderPrompt` for the runtime system prompts)
- `src/eval/evaluate-jobs.mjs` (`renderPrompt`)
- `src/eval/_evaluation-cli.mjs` and `src/eval/test-evaluation-worksheet.mjs` (`renderPrompt`, `extractWorksheetJSON`, `sameShape`)

## Notes
- `renderPrompt(root, name, values)` normalises CRLF to LF, trims trailing whitespace and appends a newline. Every source-template placeholder must exist in `values`. Values are inserted once as literal evidence: `$&` and `{{KEY}}` inside values are preserved, not expanded or rejected.
- `extractWorksheetJSON(text)` parses the JSON between `<!-- WORKSHEET_JSON_START -->` and `<!-- WORKSHEET_JSON_END -->`; `llm/prompts/cvgen/cv-worksheet.md` is the reference layout.
- `sameShape(value, template)`: objects must have the same keys in the same order; arrays are checked against the template's first element only (length is left to the caller); leaves must be strings or numbers. Booleans and `null` are rejected as leaves.
