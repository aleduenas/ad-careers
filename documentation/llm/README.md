# documentation/llm/

One page per file under `llm/`, the folder holding everything an LLM worker reads. Launcher and
prompt are a pair (layout rule 2): each page names the `src/` script that renders it, and the
validator that checks the answer. The runtime input index for the evaluation prompts is
[`llm/prompts/eval/INDEX.md`](../../llm/prompts/eval/INDEX.md).

| Page | File | One line |
|---|---|---|
| [prompts/eval/gate.md](prompts/eval/gate.md) | `llm/prompts/eval/gate.md` | Location eligibility gate on the cached JD; PASS/FAIL/REVIEW |
| [prompts/eval/company-research.md](prompts/eval/company-research.md) | `llm/prompts/eval/company-research.md` | Employer reputation and layoff research, cached 90 days per company |
| [prompts/eval/market-research.md](prompts/eval/market-research.md) | `llm/prompts/eval/market-research.md` | Canadian salary and demand evidence per role |
| [prompts/eval/scoring.md](prompts/eval/scoring.md) | `llm/prompts/eval/scoring.md` | The rubric: eight dimensions, weights parsed by the launcher |
| [prompts/eval/evaluate.md](prompts/eval/evaluate.md) | `llm/prompts/eval/evaluate.md` | The evaluation worksheet that becomes the report |
| [prompts/eval/repair.md](prompts/eval/repair.md) | `llm/prompts/eval/repair.md` | Correction suffix appended after a validation failure |
| [prompts/cvgen/cv-worksheet.md](prompts/cvgen/cv-worksheet.md) | `llm/prompts/cvgen/cv-worksheet.md` | CV tailoring worksheet (CV only; the letter is a separate call) |
| [prompts/cvgen/cv-repair.md](prompts/cvgen/cv-repair.md) | `llm/prompts/cvgen/cv-repair.md` | Path-specific validation-repair retry for the CV worksheet |
| [prompts/cvgen/cv-repair-json.md](prompts/cvgen/cv-repair-json.md) | `llm/prompts/cvgen/cv-repair-json.md` | Malformed-JSON repair retry for the CV worksheet |
| [prompts/cvgen/cv-repair-length.md](prompts/cvgen/cv-repair-length.md) | `llm/prompts/cvgen/cv-repair-length.md` | Full-worksheet repair retry when the rendered CV exceeds `max_pages` |
| [prompts/cvgen/cover-letter-worksheet.md](prompts/cvgen/cover-letter-worksheet.md) | `llm/prompts/cvgen/cover-letter-worksheet.md` | Cover-letter prompt (its own call) returning a plain-text body |
| [prompts/cvgen/writing-style-guide.md](prompts/cvgen/writing-style-guide.md) | `llm/prompts/cvgen/writing-style-guide.txt` | Private style rules inserted as `{{WRITING_STYLE}}` |
| [prompts/cvgen/cover-letter-paragraph-worksheet.md](prompts/cvgen/cover-letter-paragraph-worksheet.md) | `llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt` | Private reference paragraphs inserted as `{{COVER_LETTER_SAMPLES}}` |
| [prompts/runtime/no-tools.md](prompts/runtime/no-tools.md) | `llm/prompts/runtime/no-tools.md` | Claude system prompt for tool-less workers |
| [prompts/runtime/research.md](prompts/runtime/research.md) | `llm/prompts/runtime/research.md` | Claude system prompt for research workers with web tools |
| [compacted.md](compacted.md) | `llm/compacted/` | The two private compact twins of `config/` documents and their sync rule |

Not documented separately: `llm/README.md` (folder index) and `llm/prompts/eval/INDEX.md`
(placeholder index, linked above).
