#!/usr/bin/env node
// Worksheet contract: the live prompt's JSON, a valid answer, the validation rules,
// and slot-based adaptation into the renderer shape (independent of catalog order).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseWorksheet,
  parseAnswer,
  validateAnswer,
  mergeRepair,
  adapt,
  CVWorksheetValidationError,
  CVPageBudgetError,
} from './_cv-worksheet.mjs';
import { loadCatalog } from './_cv-content.mjs';
import { root } from '../lib/root.mjs';

const worksheet = parseWorksheet(
  readFileSync(join(root, 'llm/prompts/cvgen/cv-worksheet.md'), 'utf8'),
);
assert.ok(
  worksheet.experience && worksheet.projects && worksheet.skills && !('cover_letter' in worksheet),
  'live worksheet has the expected sections and no cover letter',
);
assert.throws(() => parseWorksheet('no markers here'), /markers/);

// parseAnswer unwraps a fenced response without costing a repair call, and
// leaves every other malformed response to the launcher's JSON repair.
assert.deepEqual(parseAnswer('{"a":1}'), { a: 1 });
assert.deepEqual(parseAnswer('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(parseAnswer('\n```\n{"a":1}\n```\n'), { a: 1 });
assert.equal(parseAnswer(JSON.stringify({ a: 'one\ntwo' })).a, 'one\ntwo');
// The failure that ends runs today: a real newline inside a string value.
assert.throws(() => parseAnswer('{"a":"one\ntwo"}'), SyntaxError);
assert.throws(() => parseAnswer('not json'), SyntaxError);

const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
const answer = () => ({
  summary: words(60),
  core_competencies: ['Python', 'SQL', 'Security automation', 'Pipelines', 'Cloud', 'Testing'],
  experience: Object.fromEntries(
    Object.keys(worksheet.experience).map((k, i) => [
      k,
      i < 3 ? ['Did a thing.', 'Did another thing.'] : [],
    ]),
  ),
  projects: Object.fromEntries(
    Object.keys(worksheet.projects).map((k, i) => [
      k,
      i < 3 ? 'A factual project description.' : '',
    ]),
  ),
  skills: Object.fromEntries(Object.keys(worksheet.skills).map(k => [k, ['Tool']])),
});
validateAnswer(answer(), worksheet);
const bad = (mutate, re) => {
  const a = answer();
  mutate(a);
  assert.throws(() => validateAnswer(a, worksheet), re);
};
bad(a => {
  a.summary = words(20);
}, /45-75 word summary/);
bad(a => {
  a.core_competencies = ['Only', 'Two'];
}, /6-8/);
bad(a => {
  const k = Object.keys(a.experience)[0];
  a.experience = { ...a.experience, renamed: a.experience[k] };
  delete a.experience[k];
}, /Missing worksheet key/);
bad(a => {
  a.experience[Object.keys(a.experience)[0]] = ['One bullet'];
}, /2-5 bullets/);
bad(a => {
  for (const k of Object.keys(a.experience).slice(0, 3))
    a.experience[k] = ['1', '2', '3', '4', '5'];
}, /5 bullets for all/);
bad(a => {
  a.experience[Object.keys(a.experience)[4]] = ['1', '2', '3', '4', '5'];
}, /at most 4/);
bad(a => {
  for (const k of Object.keys(a.projects)) a.projects[k] = '';
}, /exactly three/);
bad(a => {
  for (const k of Object.keys(a.projects)) a.projects[k] = '';
  for (const k of Object.keys(a.projects).slice(0, 2)) a.projects[k] = 'A factual project.';
}, /exactly three/);
bad(a => {
  for (const k of Object.keys(a.projects).slice(0, 4)) a.projects[k] = 'A factual project.';
}, /exactly three/);
bad(a => {
  a.skills[Object.keys(a.skills)[0]] = ['a phrase that is far too long'];
}, /at most 3 words/);
bad(a => {
  a.summary = 'REPLACE: ' + words(60);
}, /45-75 word summary/);
{
  // A letter the worker adds anyway is a stray key: dropped, never rendered.
  const a = answer();
  a.cover_letter = words(250);
  assert.ok(!('cover_letter' in validateAnswer(a, worksheet)));
}
{
  const a = answer();
  a.summary = words(20);
  const skill = Object.keys(a.skills)[0];
  a.skills[skill] = ['a phrase that is far too long'];
  let error;
  try {
    validateAnswer(a, worksheet);
  } catch (e) {
    error = e;
  }
  assert.ok(error instanceof CVWorksheetValidationError);
  assert.deepEqual(
    error.issues.map(issue => issue.path),
    ['$.summary', `$.skills.${skill}`],
  );
  assert.deepEqual(
    error.affected,
    { summary: a.summary, skills: { [skill]: a.skills[skill] } },
    'repair evidence contains only invalid JSON sections',
  );
  assert.ok(
    !('experience' in error.affected),
    'valid response sections are excluded from repair evidence',
  );

  // A validation repair returns only the failed block; mergeRepair splices it
  // into the previous answer and leaves every passing section untouched.
  const fixedSkill = ['Tool'],
    block = { summary: 'Fixed summary.', skills: { [skill]: fixedSkill }, experience: {} };
  const merged = mergeRepair(a, block, error.issues);
  assert.equal(merged.summary, 'Fixed summary.');
  assert.deepEqual(merged.skills[skill], fixedSkill);
  assert.deepEqual(merged.experience, a.experience, 'sections outside the issues are kept');
  assert.deepEqual(Object.keys(merged), Object.keys(a), 'key order is preserved');
  assert.notEqual(merged.summary, a.summary, 'the previous answer is not mutated in place');
  // A block that omits one path still lands what it returned; the omitted path
  // keeps its old value, so revalidation reports only that path again.
  const partial = mergeRepair(a, { summary: words(60) }, error.issues);
  assert.equal(partial.summary, words(60), 'the returned part of the block is kept');
  assert.throws(
    () => validateAnswer(partial, worksheet),
    e =>
      e instanceof CVWorksheetValidationError &&
      e.issues.map(issue => issue.path).join() === `$.skills.${skill}` &&
      Object.keys(e.affected).join() === 'skills',
    'only the omitted path is asked for again',
  );
  const whole = { replaced: true };
  assert.equal(
    mergeRepair('not an object', whole, [{ path: '$', reason: 'Response must be a JSON object' }]),
    whole,
    'only a non-object response is replaced wholesale',
  );
}

// Key order and stray keys are fixed in code, never by a repair; a renamed or
// missing key is reported at its own path so the repair returns only that entry.
{
  const a = answer(),
    reordered = { extra: 1, ...Object.fromEntries(Object.entries(a).reverse()) };
  reordered.skills = { stray: ['x'], ...a.skills };
  const normalized = validateAnswer(reordered, worksheet);
  assert.deepEqual(normalized, a, 'order restored and stray keys dropped without an issue');
  const k = Object.keys(a.experience)[0];
  a.experience = { ...a.experience, renamed: a.experience[k] };
  delete a.experience[k];
  let error;
  try {
    validateAnswer(a, worksheet);
  } catch (e) {
    error = e;
  }
  assert.deepEqual(
    error.issues.map(issue => issue.path),
    [`$.experience.${k}`],
  );
  assert.match(error.issues[0].reason, /Missing worksheet key/);
  assert.deepEqual(error.affected, { experience: { [k]: null } }, 'only the missing entry');
  a.projects = 'not an object';
  try {
    validateAnswer(a, worksheet);
  } catch (e) {
    error = e;
  }
  assert.ok(
    !error.issues.some(issue => issue.path === '$'),
    'a malformed section never asks for the whole worksheet',
  );
}

// CVPageBudgetError carries the full over-length answer (not a JSON-path
// fragment), so a length repair can ask for a full revised worksheet.
{
  const a = answer(),
    err = new CVPageBudgetError(3, 2, a);
  assert.equal(err.pageCount, 3);
  assert.equal(err.maxPages, 2);
  assert.equal(err.answer, a);
  assert.match(err.message, /3 pages, over the 2-page limit/);
  assert.match(new CVPageBudgetError(1, 2, a).message, /1 page,/, 'singular page count');
}

// Adaptation maps by slot, so reordering the catalog never re-labels bullets.
// Synthetic catalog keyed by the live worksheet slots (config/cv.md is private and absent in CI).
const synth = (keys, prefix) =>
  keys.map((slot, i) => ({ id: prefix + i, slot, heading: prefix + ' ' + i, required: i < 3 }));
const catalog = {
  contact: {},
  education: [],
  roles: synth(Object.keys(worksheet.experience), 'role'),
  projects: synth(Object.keys(worksheet.projects), 'project'),
};
if (existsSync(join(root, 'config/cv.md'))) {
  const live = loadCatalog(root);
  assert.deepEqual(
    live.roles.map(r => r.slot).sort(),
    Object.keys(worksheet.experience).sort(),
    'config/cv.md experience slots must match the worksheet keys',
  );
  assert.deepEqual(
    live.projects.map(p => p.slot).sort(),
    Object.keys(worksheet.projects).sort(),
    'config/cv.md project slots must match the worksheet keys',
  );
}
const a = answer();
const first = Object.keys(worksheet.experience)[0];
a.experience[first] = ['Marker bullet for the first slot.', 'Second bullet.'];
const adapted = adapt(a, catalog);
const target = catalog.roles.find(r => r.slot === first);
assert.equal(
  adapted.roles.find(r => r.id === target.id).bullets[0].text,
  'Marker bullet for the first slot.',
);
const reversed = {
  ...catalog,
  roles: [...catalog.roles].reverse(),
  projects: [...catalog.projects].reverse(),
};
const adaptedReversed = adapt(a, reversed);
assert.equal(
  adaptedReversed.roles.find(r => r.id === target.id).bullets[0].text,
  'Marker bullet for the first slot.',
  'slot mapping survives catalog reordering',
);
assert.equal(adapted.roles.filter(r => r.include).length, 3);
assert.equal(adapted.projects.filter(p => p.include).length, 3);
assert.throws(
  () => adapt(a, { ...catalog, roles: catalog.roles.map(r => ({ ...r, slot: '' })) }),
  /no slot marker/,
);
assert.throws(() => adapt(a, { ...catalog, roles: catalog.roles.slice(1) }), /no catalog entry/);
console.log(
  'CV worksheet tests passed: live worksheet parse, path-specific repair evidence, block repair merging, key normalization, validation rules, no letter in the CV worksheet, slot adaptation and reorder safety.',
);
