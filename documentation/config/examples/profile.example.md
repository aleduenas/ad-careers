# config/examples/profile.example.yml

**Authority:** [config/examples/profile.example.yml](../../../config/examples/profile.example.yml).

Renderer identity example.

## Run and callers

Copy to private config/profile.yml and replace fictional contact values.

## Inputs

Only candidate name, email, phone, LinkedIn, GitHub and the optional `spoken_languages` line (rendered last in the CV contact row) are included. Targeting belongs in config/profile.md and its compact twin, not this YAML.

## Behavior and outputs

Read by people during setup; `_cv-content.mjs` and `_cv-drafting.mjs` read the copied private file. No automatic writes.
