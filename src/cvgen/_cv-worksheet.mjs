// Literal CV worksheet contract: parse the worksheet JSON out of the prompt,
// validate the worker's answer against it, and adapt the answer into the
// renderer's shape using the canonical catalog (src/cvgen/_cv-content.mjs).
//
// Slot mapping: each worksheet experience/project key names a slot; each
// catalog entry declares its slot with an HTML comment in config/cv.md
// (`<!-- slot: data_consulting -->` under the heading). Titles, employers and
// dates always come from the catalog, never from the model.

export function parseWorksheet(promptSource) {
  const start = '<!-- WORKSHEET_JSON_START -->',
    end = '<!-- WORKSHEET_JSON_END -->';
  const a = promptSource.indexOf(start),
    b = promptSource.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error('Worksheet JSON markers are missing or malformed');
  return JSON.parse(promptSource.slice(a + start.length, b).trim());
}

// parseAnswer turns one worker response into the answer object. Workers
// sometimes wrap the worksheet in a Markdown code fence; unwrapping that is
// unambiguous and costs no model call, so it happens here rather than through a
// repair. Anything else malformed throws SyntaxError, which the launcher repairs
// with the parser's own message (llm/prompts/cvgen/cv-repair-json.md).
export function parseAnswer(text) {
  return JSON.parse(
    String(text)
      .trim()
      .replace(/^```(?:json)?\s*|\s*```$/g, ''),
  );
}

const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = v =>
  typeof v === 'string' && v.trim() && !/^REPLACE:/i.test(v.trim()) && !/[{}<>]/.test(v);
const words = v => String(v).trim().split(/\s+/).length;

const pathParts = path =>
  path
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean);

const affectedJSON = (answer, issues) => {
  if (issues.some(issue => issue.path === '$')) return answer;
  const affected = {};
  for (const { path } of issues) {
    const parts = pathParts(path);
    let source = answer,
      target = affected;
    for (const [i, part] of parts.entries()) {
      if (i === parts.length - 1) {
        target[part] =
          source && typeof source === 'object' && Object.hasOwn(source, part) ? source[part] : null;
        break;
      }
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
      source = source && typeof source === 'object' ? source[part] : undefined;
    }
  }
  return affected;
};

export class CVWorksheetValidationError extends Error {
  constructor(issues, answer) {
    super(issues.map(issue => `${issue.path}: ${issue.reason}`).join('; '));
    this.name = 'CVWorksheetValidationError';
    this.issues = issues;
    this.answer = answer;
    this.affected = affectedJSON(answer, issues);
  }
}

// Thrown after a worksheet answer validates and renders, but the rendered PDF
// exceeds the page budget. Unlike CVWorksheetValidationError, no JSON path is
// at fault, so the repair prompt asks for a full revised worksheet rather than
// one block; `answer` is the full validated (over-length) answer to trim from.
export class CVPageBudgetError extends Error {
  constructor(pageCount, maxPages, answer) {
    super(
      `CV rendered to ${pageCount} page${pageCount === 1 ? '' : 's'}, over the ${maxPages}-page limit`,
    );
    this.name = 'CVPageBudgetError';
    this.pageCount = pageCount;
    this.maxPages = maxPages;
    this.answer = answer;
  }
}

// normalizeAnswer puts keys in worksheet order and drops keys the worksheet
// does not have, at the top level and inside object sections (experience,
// projects, skills). Order and stray keys are fixable without a model call, so
// they never cost a repair; a missing key stays missing and is reported at its
// own path by validateAnswer.
export function normalizeAnswer(answer, worksheet) {
  if (!isObject(answer) || !isObject(worksheet)) return answer;
  const out = {};
  for (const [key, example] of Object.entries(worksheet))
    if (Object.hasOwn(answer, key))
      out[key] = isObject(example) ? normalizeAnswer(answer[key], example) : answer[key];
  return out;
}

// mergeRepair splices a repair response into the previous answer. A validation
// repair returns only the failed block (the issue paths, nested as in the
// worksheet), so every section that already passed is carried over from the
// previous answer unchanged and a repair can never regress it. Each issue path
// the block contains is taken; one it omits keeps its previous value, which
// validation then reports again with its real reason. Only a response that was
// not a JSON object at all ('$') is replaced wholesale.
export function mergeRepair(previous, block, issues) {
  if (issues.some(issue => issue.path === '$')) return block;
  const merged = structuredClone(previous);
  for (const { path } of issues) {
    const parts = pathParts(path);
    let source = block,
      target = merged;
    for (const [i, part] of parts.entries()) {
      if (!isObject(source) || !Object.hasOwn(source, part)) break;
      if (i === parts.length - 1) target[part] = source[part];
      else {
        if (!isObject(target[part])) target[part] = {};
        target = target[part];
        source = source[part];
      }
    }
  }
  return merged;
}

// validateAnswer normalizes the answer (normalizeAnswer), checks it and returns
// the normalized answer. Every issue carries the narrowest JSON path that can be
// repaired on its own; only a response that is not a JSON object uses '$'.
export function validateAnswer(rawAnswer, worksheet) {
  const issues = [],
    add = (path, reason) => issues.push({ path, reason });
  if (!isObject(rawAnswer))
    throw new CVWorksheetValidationError(
      [{ path: '$', reason: 'Response must be a JSON object' }],
      rawAnswer,
    );
  const answer = normalizeAnswer(rawAnswer, worksheet),
    missing = key => `Missing worksheet key "${key}"; return it`;
  if (!text(answer.summary) || words(answer.summary) < 45 || words(answer.summary) > 75)
    add('$.summary', 'Response must provide a 45-75 word summary');
  if (
    !Array.isArray(answer.core_competencies) ||
    answer.core_competencies.length < 6 ||
    answer.core_competencies.length > 8 ||
    answer.core_competencies.some(v => !text(v) || words(v) > 3)
  )
    add(
      '$.core_competencies',
      'core_competencies must contain 6-8 values of at most 3 words each (no ampersands or parenthetical lists)',
    );
  const experienceShape = isObject(answer.experience),
    projectShape = isObject(answer.projects),
    skillShape = isObject(answer.skills);
  if (!experienceShape)
    add('$.experience', 'experience must be an object keyed by the worksheet role keys');
  if (!projectShape)
    add('$.projects', 'projects must be an object keyed by the worksheet project keys');
  if (!skillShape) add('$.skills', 'skills must be an object keyed by the worksheet skill keys');
  if (experienceShape) {
    const roles = Object.keys(worksheet.experience),
      requiredBulletCounts = [];
    for (const [i, key] of roles.entries()) {
      const bullets = answer.experience[key];
      if (!Object.hasOwn(answer.experience, key)) {
        add(`$.experience.${key}`, missing(key));
        continue;
      }
      if (!Array.isArray(bullets) || bullets.some(v => !text(v))) {
        add(`$.experience.${key}`, 'Experience values must be arrays of plain-text bullets');
        continue;
      }
      if (i < 3) {
        if (bullets.length < 2 || bullets.length > 5)
          add(`$.experience.${key}`, 'Each required role needs 2-5 bullets');
        requiredBulletCounts.push(bullets.length);
      } else if (bullets.length > 4)
        add(`$.experience.${key}`, 'Optional roles may have at most 4 bullets');
    }
    if (requiredBulletCounts.length === 3 && requiredBulletCounts.every(count => count === 5))
      add('$.experience', 'Do not use 5 bullets for all required roles');
  }
  if (projectShape) {
    // Projects are one block: the three-project rule spans every key.
    const values = Object.keys(worksheet.projects).map(key => answer.projects[key]),
      included = values.filter(v => text(v));
    if (included.length !== 3 || values.some(v => typeof v !== 'string'))
      add(
        '$.projects',
        'Include exactly three non-empty projects and leave the rest as empty strings',
      );
  }
  if (skillShape)
    for (const key of Object.keys(worksheet.skills)) {
      const values = answer.skills[key];
      if (!Object.hasOwn(answer.skills, key)) add(`$.skills.${key}`, missing(key));
      else if (!Array.isArray(values) || values.some(v => !text(v) || words(v) > 3))
        add(
          `$.skills.${key}`,
          'Skill values must be plain-text arrays of at most 3 words per item (no ampersands or parenthetical lists)',
        );
    }
  if (issues.length) throw new CVWorksheetValidationError(issues, answer);
  return answer;
}

export function adapt(answer, catalog) {
  const claim = value => ({ text: value.trim() });
  const bySlot = (entries, kind) => {
    const map = new Map();
    for (const e of entries) {
      if (!e.slot)
        throw new Error(`${kind} entry has no slot marker in config/cv.md: ${e.heading}`);
      if (map.has(e.slot)) throw new Error(`Duplicate ${kind} slot in config/cv.md: ${e.slot}`);
      map.set(e.slot, e);
    }
    return map;
  };
  const roleSlots = bySlot(catalog.roles, 'experience'),
    projectSlots = bySlot(catalog.projects, 'project');
  for (const key of Object.keys(answer.experience))
    if (!roleSlots.has(key))
      throw new Error('Worksheet experience slot has no catalog entry: ' + key);
  for (const key of Object.keys(answer.projects))
    if (!projectSlots.has(key))
      throw new Error('Worksheet project slot has no catalog entry: ' + key);
  return {
    format: 'letter',
    summary: claim(answer.summary),
    competencies: answer.core_competencies.map(claim),
    roles: catalog.roles.map(role => {
      const bullets = answer.experience[role.slot] || [];
      return { id: role.id, include: bullets.length > 0, bullets: bullets.map(claim) };
    }),
    projects: catalog.projects.map(project => {
      const description = answer.projects[project.slot] || '';
      return {
        id: project.id,
        include: !!description.trim(),
        description: claim(description || ''),
        technologies: [],
      };
    }),
    skills: Object.entries(answer.skills)
      .filter(([, items]) => items.length)
      .map(([category, items]) => ({
        category: category.replaceAll('_', ' '),
        items: items.map(claim),
      })),
    keywords: [],
  };
}
