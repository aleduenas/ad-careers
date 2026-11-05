# config/examples/cv-content-policy.example.json

**Authority:** [config/examples/cv-content-policy.example.json](../../../config/examples/cv-content-policy.example.json).

Required-role policy example.

## Run and callers

Copy to config/cv-content-policy.json and replace the placeholder with exact headings from config/cv.md.

## Inputs

required_role_headings names canonical experience entries, not model-generated titles. Keep slot markers synchronized with the worksheet keys.

## Behavior and outputs

Read by `_cv-content.mjs::loadCatalog`; missing required headings fail before generation. No automatic writes.
