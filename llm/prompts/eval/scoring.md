Score each dimension from 1 to 5 using the supplied candidate facts, targeting,
job description and research. Use the full range; score the actual role rather
than its title. Do not calculate a weighted total or apply adjustments.

This table is the single authority for dimension names and weights. The launcher
reads names and weights from it; weights must sum to 100.

| Dimension | Weight | What it measures | Score anchors |
|---|---:|---|---|
| North Star alignment | 11% | How closely the actual role matches one of the candidate's target archetypes (see targeting). | 5 = exact target archetype, including Security Engineer / Detection Engineer / SIEM-SOAR Automation roles on their own with no AI/ML component required; 4 = strong adjacent archetype with meaningful overlap; 3 = plausible hybrid with real but partial overlap; 2 = distant, minor overlap only; 1 = no meaningful overlap with any target archetype. Reserve 1 for genuinely unrelated work. |
| CV match | 20% | Share of the JD's material requirements evidenced in the supplied CV. | 5 = about 90% or more of material requirements met; 4 = most met with minor gaps; 3 = mixed evidence and gaps; 2 = several core requirements missing; 1 = under 40% match. |
| YoE gap | 20% | Distance between the JD's required years of experience and the candidate's actual total, recomputed from CV dates without double-counting overlapping roles. | 5 = required YoE at or below actual; 4 = required 0-1 year above actual; 3 = required 1-2 years above actual; 2 = required 2-3 years above actual; 1 = required 3 or more years above actual. |
| Estimated compensation | 14% | Likely pay for this role versus the candidate's floor and the market research. | 5 = clearly above floor and at or above market top quartile; 4 = comfortably above floor, at market; 3 = uncertain or near floor; 2 = likely below floor; 1 = clearly below floor and market. |
| Growth trajectory | 14% | Whether the role is a credible next step toward the candidate's target path (including a plausible route to DevSecOps for security-adjacent roles). | 5 = clear path to the next level; 4 = likely growth with some uncertainty; 3 = some relevant growth; 2 = lateral with little growth; 1 = dead end or regression. |
| Company reputation | 7% | Employer quality from the research: stability, layoffs, glassdoor-type signals, hiring history. | 5 = strong positive evidence; 4 = mostly positive; 3 = limited or mixed evidence; 2 = notable concerns; 1 = credible red flags. |
| Tech stack modernity | 7% | Currency of the tooling the role will actually use. | 5 = modern AI/ML stack OR a modern security automation stack (SIEM/SOAR, detection-as-code, cloud-native security tooling, EDR/XDR, IaC for security infrastructure); 4 = mostly modern; 3 = mixed or current; 2 = mostly dated; 1 = predominantly legacy tooling on both fronts. |
| Cultural signals | 7% | Evidence about how the team works: builder culture, healthy management, bureaucracy. | 5 = strong builder or healthy-team evidence; 4 = mostly positive signals; 3 = limited or mixed evidence; 2 = some concerning signals; 1 = credible concerning signals or bureaucratic dysfunction. |

For intermediate cases, choose the nearest score. Location is a separate
eligibility gate, not a score.
