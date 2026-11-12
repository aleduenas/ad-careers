# config/examples/llm-providers.example.json

**Authority:** [config/examples/llm-providers.example.json](../../../config/examples/llm-providers.example.json)
and `documentation/dashboard-migration/design/STAGE3_PROVIDERS_CONTRACT.md`.

Synthetic example of the browser dashboard's provider settings file.

## Run and callers

Normally nothing copies this by hand: the dashboard's Providers page writes the private
`config/llm-providers.json` on the first explicit save (all four functions at once, atomically).
Copy it only to pre-seed the file. `src/server/providers.mjs` reads and writes it.

## Inputs

`version` is 1. `functions` names a `provider` (`claude` or `codex`, shown as OpenAI in the UI) and
a non-empty `model` (at most 80 characters, no control characters) for each of `evaluation`,
`companyResearch`, `cv` and `coverLetter`. The sample values are the launchers' own defaults plus
one Codex row to show the shape; they are not a recommendation.

The optional `models` object (`claude` and `codex`, each 1 to 50 ids of at most 80 characters)
replaces the model list the UI offers for that provider; the shown values are the built-in
defaults. An invalid list is ignored for that provider and the defaults apply. A function's
configured model that is not listed is still honored and shown as Other. Saving keeps `models`.

## Behavior and outputs

While `config/llm-providers.json` is absent the dashboard derives the effective values read-only
from `config/evaluation-cli.json` and `config/cv-drafting.json` and labels them `legacy`; nothing
is written until a save. Executable paths stay in `config/cv-drafting.json`. The file holds no
credentials: logins are the local `claude auth login` and `codex login` sessions.
