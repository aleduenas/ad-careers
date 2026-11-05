# Job evaluation

The dashboard Evaluate action runs the same launcher; from a terminal:

```powershell
node src/eval/evaluate-jobs.mjs --job=123
node src/eval/evaluate-jobs.mjs --select="Aviva"
node src/eval/evaluate-jobs.mjs --next=5
node src/eval/evaluate-jobs.mjs --next=5 --dry-run
node src/eval/evaluate-jobs.mjs --next=5 --prepare-only
node src/eval/evaluate-jobs.mjs --resume=RUN_ID
node src/eval/evaluate-jobs.mjs --doctor
node src/eval/evaluate-jobs.mjs --smoke
node src/eval/evaluate-jobs.mjs --smoke-research
node src/eval/evaluate-jobs.mjs --smoke-evaluation
```

Selection uses Pending entries and permanent IDs. Cached JDs only; missing JDs
produce minimal Discarded reports without a model call. Ambiguous location returns
REVIEW and leaves the job pending. Correct cached evidence and start a new run.
No submissions or CV generation occur.

JDs added manually through the dashboard carry `source: manual-paste` in their
stored frontmatter. They skip the location gate and proceed directly as eligible,
because manual intake represents the user's eligibility decision. This bypass is
limited to that frontmatter marker; matching words in a JD body do not qualify.
All research, scoring, validation and publication phases still run normally.

The script checks company-cache presence and each section's 90-day freshness in
code before invoking company research. Fresh sections are reused. Only missing or
expired sections are researched, once per company for eligible jobs in the run.
Role salary/demand research remains per-role. Research receives no candidate data.
Unavailable research is disclosed; failed sections are never stamped fresh.

Gate requests contain only eligibility instructions and the JD. Evaluation
requests contain candidate facts, compact targeting, rubric, cached JD, relevant
scan-history rows, and market salary evidence only when the JD lacks an advertised
band. Workers return the literal JSON worksheet embedded
in the active prompt source; they never write Markdown tables or report formatting.
Scripts validate that prompt-owned contract, render the six-block report, calculate
weighted scores and commit each result to PostgreSQL. The database enforces permanent
IDs, posting identity and completion idempotency.

Block B uses separate requirement/evidence/match/mitigation cells, grouped into
6–8 rows where possible (10 slots maximum); unused rows are NONE. The target is
250–350 words, with a 460-word validation ceiling. No separate repeated gap essays.
Other narrative fields carry concise word-limit instructions; the script does
not truncate factual text. Research dates retain source precision (year, month,
day, or explicitly UNKNOWN); missing publication dates do not require inventing
precision or discarding otherwise sourced evidence.

Research worksheets have separate fact, source-date and URL slots. A format repair
has all web tools disabled and receives previous answers as evidence. Valid
sections are saved to a partial checkpoint and retained even if other fields fail.
Search budgets are stated in the research prompt (four searches/four fetches);
they are model instructions, not a hard provider quota. Cached stages skip calls.
Token debug logs use the CLI's per-model totals when available, with top-level
usage retained separately; cache read/write tokens are not added twice.

All workflow inputs, responses, logs, state and staging are inside
`logs/evaluation/RUN_ID`. Each run stores the exact rendered prompts for every
attempt plus a `prompt-sources/` snapshot of every static evaluation, repair and
runtime prompt used by that run. `run.json` records the provider, models, system
prompt paths, web-search setting and the Git source revision when available.
Disposable CLI working directories are inside
`logs/workers`, shared with CV generation. CLI authentication and provider-owned
runtime state remain in the normal provider locations. Claude safe mode and memory
exclusions suppress project instructions, skills, hooks and MCP. Codex disables
AGENTS.md loading and shell tools with read-only execution; research enables live
web search. Managed provider policies may still apply. This is context isolation,
not an operating-system filesystem boundary.

Defaults: Claude Sonnet for evaluation, Haiku for research, two concurrent
processes. `--provider=codex` uses gpt-5.5 for both stages. Optional user-layer
`config/evaluation-cli.json` overrides:

```json
{
  "default_provider": "claude",
  "claude_model": "sonnet",
  "claude_research_model": "haiku",
  "codex_model": "gpt-5.5",
  "codex_research_model": "gpt-5.5",
  "max_concurrency": 2,
  "max_repairs": 2,
  "timeout_ms": 600000
}
```

Executable paths inherit `config/cv-drafting.json` unless overridden with
`claude_command`/`codex_command`. Use native executables on Windows. Subscription
logins only; no API-key or model fallback. Doctor checks the selected login; smoke
sends a tiny request and consumes subscription allowance. Research smoke verifies
public web search/retrieval without evaluating a job. Dry run writes nothing;
prepare-only snapshots inputs without CLI calls or tracker changes.

Resume reuses matching successful stage responses and staged reports. Changes to
candidate inputs or the JD require a new run. Exit 0 means complete/prepared;
exit 2 means some jobs are FAILED or REVIEW; exit 1 means a launcher/finalization
failure. Successful jobs still finalize when others fail. Logs identify the stage.
Research failures are recorded as unavailable, allowing an honest evaluation.
Renewable per-job database leases prevent competing evaluations. Shared company research uses a separate lease. Expired leases can be claimed after a crash; ownership tokens prevent stale workers from committing.

Isolation references: [Claude memory exclusions](https://code.claude.com/docs/en/memory#exclude-specific-claudemd-files),
[Claude CLI options](https://code.claude.com/docs/en/cli-reference), and
[Codex configuration](https://developers.openai.com/codex/config-reference).

## Files involved

- Launcher: `src/eval/evaluate-jobs.mjs`; validation, rubric parsing, report rendering and CLI invocation in `src/eval/_evaluation-cli.mjs`; worksheet decoding in `src/eval/_evaluation-worksheet.mjs`; research freshness in `src/eval/_evaluation-plan.mjs`; shared process runtime in `src/lib/cli-runtime.mjs`.
- Prompts: `llm/prompts/eval/` (gate, company-research, market-research, scoring, evaluate, repair) and `llm/prompts/runtime/` (system prompts). `llm/prompts/eval/INDEX.md` lists every substituted input.
- Rubric: `llm/prompts/eval/scoring.md` is the single authority for dimensions and weights (parsed at load; must sum to 100). Rationale: `scoring-rubric.md`.
- Candidate inputs: `llm/compacted/cv-compact.md` (facts) and `llm/compacted/candidate-targeting.md` (targeting, the compact twin of `config/profile.md`).
- Outputs: report under `data/evaluations/<id>-<company>-<role>-<date>.md`, `jobs` and `evaluations` rows, research cache under `data/company-info/`, run evidence under `logs/evaluation/RUN_ID`.
