# llm/prompts/eval/scoring.md

**Kind:** worker prompt fragment (the scoring rubric; inserted whole into `evaluate.md`)

**Purpose:** The single authority for the eight scoring dimensions, their weights and their
1 to 5 anchors. The evaluator reads it as `{{SCORING_RUBRIC}}`; the launcher parses the same
table to obtain dimension names and weights for the weighted score. Location is not a
dimension; it is the separate gate.

**Substituted by:** no placeholders of its own. `src/eval/evaluate-jobs.mjs` reads the file into
`state.sources` and passes its text as `SCORING_RUBRIC` to `renderPrompt('eval/evaluate.md')`.
`loadRubric()` in `src/eval/_evaluation-cli.mjs` parses every table row matching
`| <name> | <NN>% |` and throws unless the weights sum to 100; the resulting `dimensions` and
`weights` arrays drive `evaluationDecode`, `validateEvaluation` and `render`.

**Placeholders:** none.

**Expected response:** not applicable; the model never answers this file directly.

**Notes:**

- The dimension names in the table must be byte-identical to the keys of `scores` in the
  `evaluate.md` worksheet: `evaluationDecode` looks up `raw.scores[dimension]` by name and
  `validateEvaluation` checks the ordered names again.
- Weights must be integers followed by `%` in the second column; the parser ignores any row
  without that shape (including the header).
- Why the rubric looks the way it does is explained in
  [`documentation/guides/scoring-rubric.md`](../../../guides/scoring-rubric.md); the table here
  is the rubric itself.
- Observation: the anchors mention target archetypes that are also described in
  `llm/compacted/candidate-targeting.md`; a targeting change there may need a matching anchor
  change here.
