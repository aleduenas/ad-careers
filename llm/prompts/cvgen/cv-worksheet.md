You are the hiring manager for the job posted below. You are optimizing the CV for the job description below using the candidate CV below. Select only facts explicitly supported by the candidate CV. Never: infer
experience, invent achievements, alter factual details, or add unsupported
technologies. Create the CV you would be most likely to give an interview for according to the job posted. Critically important you NEVER make up any experience, achievements or credentials, you never include something thats not directly stated in the CV (paraphrasing to change the framing is fine but it must be factual)
The hiring-manager view decides which facts are selected and in what order. The wording follows the writing style guide below.

Return EXACTLY AND ONLY the JSON worksheet below. Keep every key, key order,
object, array, and nesting exactly as supplied. Replace only the placeholder
values. Do not add, remove, rename, reorder, or move keys. Do not return
Markdown, a code fence, explanations, notes, or any text before or after JSON.

## Writing style guide

{{WRITING_STYLE}}

## Job description

{{JOB_DESCRIPTION}}

## Evaluation CV-customization guidance

{{CV_CUSTOMIZATION_CONTEXT}}

This is advisory planning context from the evaluation's CV-customization
section, not candidate evidence. Apply a suggestion only when it is supported
by the candidate CV below. The candidate CV remains the sole source of facts.

## Candidate CV

{{CANDIDATE_CV}}

## JSON worksheet to complete

<!-- WORKSHEET_JSON_START -->
{
  "summary": "REPLACE: 45-75 words. MUST be more than 1 sentence, aim for 3; state the candidate's most relevant function, domain, and supported strengths for this job. Always frame the candidate in the best light for the role posted (try to match the role in the JD)",
  "core_competencies": [
    "REPLACE: 6-8 demonstrated competencies, each 1-3 whitespace-separated words, no ampersands or parentheses (e.g. Detection Engineering, Threat Modeling, ETL Pipelines); check every item before returning"
  ],
  "experience": {
    "data_consulting": [
      "REPLACE: 3-5 concise factual achievement bullets for the current AI and security engineering role, which the candidate performs as an independent consultant"
    ],
    "software_development": [
      "REPLACE: 3-5 concise factual achievement bullets for the software development (ai focus) role"
    ],
    "information_security_consulting": [
      "REPLACE: 3-5 concise factual achievement bullets for the information security consulting role"
    ],
    "teaching_assistant": [],
    "research_assistant": [],
    "retail_sales": []
  },
  "projects": {
    "client_reporting_dashboard": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "client_ats_platform": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "entity_resolution_pipeline": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "fairness_autoencoder": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "portfolio_optimization_agent": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "threat_intelligence_pipeline": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "storm_2949_detection_design": "REPLACE: 60-90 word factual project description of this production-level detection design, preserving the strongest exact metrics; never claim deployment or measured detection performance, and never add a disclaimer about what was not done; empty string if not one of the 3 selected projects",
    "attack_mapping_lookup": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "llm_job_search_pipeline": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string",
    "ci_identity_heist_demo": "REPLACE: 60-90 word factual project description if this is one of the 3 selected projects, otherwise an empty string"
  },
  "skills": {
    "security": ["REPLACE: demonstrated security tools or keywords, each 1-3 words (e.g. Splunk, MITRE ATTACK, Vulnerability Scanning)"],
    "cloud": ["REPLACE: demonstrated cloud tools or keywords, each 1-3 words (e.g. AWS Lambda, Terraform, Docker)"],
    "data_and_analytics": ["REPLACE: demonstrated data, ML, or presentation tools, each 1-3 words (e.g. PyTorch, Power BI, Snowflake)"],
    "development_tools": ["REPLACE: demonstrated development tools or keywords, each 1-3 words (e.g. Python, Git, CI/CD)"]
  }
}
<!-- WORKSHEET_JSON_END -->

Every value inside `experience` MUST be a JSON list (array) of bullet-point
strings. Do not combine bullets into one string, use an object, use Markdown
bullets, or change an experience value into another type. For example:
`"data_consulting": ["first bullet", "second bullet"]`.

CV EXPERIENCE AND PROJECTS
Each experience bullet should contain one main proof point.
Start every experience bullet with an action verb. Never use "I" in a bullet.
Write each bullet as one complete statement of 15 to 30 words. It must say what was built or done, with what, and what it achieved or was for when the candidate CV supports that. A bullet that names only a tool or a duty is too vague.
Prefer specific actions, tools, scope, outputs, and measured effects.
Use past tense for work performed in ended roles.
Use present tense only for current work or for a system that still operates when the source supports that claim.
Leave optional projects empty when they do not materially support the target job.
Some work is both a project and part of a role. Describe such a system once. When it is one of the 3 selected projects, each role it belongs to may mention it in at most one bullet, and that bullet must not repeat the project description. When it is not selected, it may take at most two bullets in a role. One system must never fill most of a role's bullets.
Do not turn bullets or project descriptions into technology inventories.
A line starting with `Boundary:` in the candidate CV states the limit of the evidence for that role or project. Never write a claim that goes past it. Never print the boundary, and never add a disclaimer, hedge or apology about what was not done. Describe the work for its substance.
The first three experience arrays are mandatory and must each contain 3-5
concise bullet strings. If a role is more relevant than the others, use more bullets and be slightly more verbose and deliberate. Do NOT use 5 bullets for all 3 experiences. Always leave `teaching_assistant` and `research_assistant` as empty JSON arrays: `[]`. Leave `retail_sales` as `[]` unless the job description explicitly
asks for retail, customer service or store operations experience. Fill in exactly 3 projects and leave every other project as an empty string `""`. Select the ones that are the most useful for the cv and demonstrative to the role (security domain projects for security roles, data/ML for ml roles, ai for ai roles. in hybrid roles like ai security use your best judgement).
project descriptions should follow this format (60-90 words):
short description of the project (what it does and why - the why only if necessary). tools used and how it was done. results or performance metrics.

Every `core_competencies` item and every `skills` item is at most 3
whitespace-separated words. The validator counts words by splitting on spaces,
so a symbol surrounded by spaces counts as a word. Never use an ampersand (`&`):
write "and" or pick the shorter term. Never add a parenthetical list or a comma
list inside one item; split it into separate items instead. The examples in the
worksheet show the format only; include a term only when the candidate CV
supports it. A term the candidate CV marks as familiar, exposure or concepts may
appear in a `skills` list only when the job description names it, and is never
written as hands-on experience in the summary, bullets or project descriptions.

- Good: "Detection Engineering", "Incident Response", "AWS Lambda", "MITRE ATTACK", "CI/CD"
- Bad: "IAM & Zero Trust" (ampersand, 4 words), "AWS (EC2, Lambda, S3)" (parenthetical list), "Compliance (NIST, ISO 27001)" (parenthetical list), "Azure Security Posture Review" (4 words)
