# Scoring rubric: rationale and history

**Authority:** `llm/prompts/eval/scoring.md`. That file is the rubric itself (dimension, weight, what it measures, 1–5 anchors). `src/eval/_evaluation-cli.mjs` parses the dimension names and weights from its table at load time and refuses to run if the weights do not sum to 100; `src/eval/test-evaluation-cli.mjs` asserts the same. To change scoring, edit that one file.

This document explains *why* the rubric is what it is. It is not read by any script.

## Current weights (since 2026-08-19)

| Dimension | Weight |
|---|---:|
| North Star alignment | 11% |
| CV match | 20% |
| YoE gap | 20% |
| Estimated compensation | 14% |
| Growth trajectory | 14% |
| Company reputation | 7% |
| Tech stack modernity | 7% |
| Cultural signals | 7% |

Location is a pass/fail eligibility gate (`prompts/evaluation/gate.md`), not a scored dimension. The launcher computes the weighted total; the model never does.

## How the current weights were derived

**2026-08-18 restructure.** The inherited rubric had eleven dimensions. Three were removed:

- *Level (seniority fit)*: overlapped heavily with CV match and the new YoE gap, and repeatedly mis-scored titles far above actual qualifications. Level detection and the "sell senior" plan still happen narratively in Block C; they no longer feed the score.
- *Remote quality / Location*: location either works or it does not. It became a gate that stops the evaluation on failure rather than a graded input with partial credit.
- *Time-to-offer speed*: not worth grading a job on how fast it fills.

One was added:

- *YoE gap*: distance between the JD's required years and actual total years computed from `config/cv.md` dates at evaluation time (never a hard-coded figure). The most predictive single signal for whether a role is realistically reachable, so it carries real weight.

*North Star alignment* was also graded less harshly: it had been near-binary (5 = exact archetype, 1 = anything else), which punished plausible hybrid and adjacent roles too hard. It is now a spread with 3 as the default for hybrid roles and 1 reserved for genuinely unrelated work.

The removed dimensions freed 30 points (Level 18, Location 6, Time-to-offer 6). The remaining 70 points were scaled proportionally (x1.214) to fill the 85% left after reserving a flat 15% for YoE gap.

**2026-08-19: YoE gap 15% to 20%.** The other seven dimensions were scaled by 80/85 and rounded, with a one-point rounding correction taken from CV match to land on exactly 100.

**2026-09-17: security engineering archetype broadened.** The rubric had drifted toward treating AI/ML content as a prerequisite for a high North Star or Tech stack score, so pure security-engineering roles (detection engineering, SIEM/SOAR automation, IR tooling) were scoring 1–2 even though they are a genuine, preferred target. Security Engineer is now a core archetype on equal footing with the AI archetypes; North Star and Tech stack modernity anchors were updated so these roles reach 4–5 without AI/ML content.

## Standing guidance for future rebalances

- Keep the proportional-redistribution method for the inherited dimensions unless told otherwise.
- Growth trajectory should account for a plausible path toward DevSecOps when scoring security-adjacent roles, even when the immediate role is not hands-on engineering.
- YoE gap must always be recomputed from CV work-history dates.
- Consistency rulings for specific gap types live with the candidate targeting file (`config/evaluation-candidate.md`), not here.
