import assert from 'node:assert/strict';
import { renderPrompt, extractWorksheetJSON, sameShape } from '../lib/_prompt-templates.mjs';
import {
  passthrough,
  researchDecode,
  evaluationDecode,
  validEvidenceDate,
  formatCompensation,
} from './_evaluation-worksheet.mjs';
import {
  dimensions,
  validateEvaluation,
  validateResearch,
  validateGate,
} from './_evaluation-cli.mjs';

import { root } from '../lib/root.mjs';

// Every worksheet field the app asks for is a literal JSON key written
// directly into the rendered .md prompt — never assembled only in JS.
const gatePrompt = renderPrompt(root, 'eval/gate.md', { CACHED_JD: 'Some JD text' });
assert.ok(
  renderPrompt(root, 'eval/gate.md', {
    CACHED_JD: 'Literal {{CACHED_JD}} and {{UNKNOWN}} with $&',
  }).includes('Literal {{CACHED_JD}} and {{UNKNOWN}} with $&'),
);
assert.throws(() => renderPrompt(root, 'eval/gate.md', {}), /Missing prompt value CACHED_JD/);
const gateTemplate = extractWorksheetJSON(gatePrompt);
assert.deepEqual(Object.keys(gateTemplate), ['decision', 'reason', 'location']);
const gateAnswer = {
  decision: 'PASS',
  reason: 'Toronto\nHybrid "quoted" evidence',
  location: 'Toronto, ON',
};
assert.ok(sameShape(gateAnswer, gateTemplate));
const decodedGate = passthrough.decode(gateAnswer);
assert.equal(decodedGate.decision, 'PASS');
validateGate(decodedGate);
assert.ok(!sameShape({ decision: 'PASS' }, gateTemplate), 'missing keys must fail shape check');
assert.ok(
  !sameShape({ ...gateAnswer, extra: 'nope' }, gateTemplate),
  'extra keys must fail shape check',
);

const marketPrompt = renderPrompt(root, 'eval/market-research.md', {
  COMPANY: 'Acme',
  ROLE: 'Engineer',
  LOCATION: 'Toronto, ON',
  DATE: '2026-09-18',
});
const marketTemplate = extractWorksheetJSON(marketPrompt);
const marketAnswer = {
  limitations: 'NONE',
  sections: {
    'Role market': {
      evidence: [
        {
          fact: 'Quoted "employee" evidence\nA second line',
          date: '2026-09',
          url: 'https://example.com/source',
        },
      ],
    },
  },
};
assert.ok(sameShape(marketAnswer, marketTemplate));
const decodedMarket = researchDecode(['Role market'])(marketAnswer, true);
assert.ok(decodedMarket.sections['Role market'].includes('https://example.com/source'));
validateResearch(decodedMarket, ['Role market']);
assert.equal(
  researchDecode(['Role market'])(
    {
      ...marketAnswer,
      sections: { 'Role market': { evidence: [{ fact: 'x', date: '2026-09', url: 'invented' }] } },
    },
    false,
  ).sections['Role market'],
  null,
);
for (const date of [
  '2026',
  '2026-09',
  '2024-02-29',
  'UNKNOWN',
  'UNAVAILABLE',
  'accessed 2026-09-17',
]) {
  assert.ok(validEvidenceDate(date), date);
  const answer = {
    limitations: 'NONE',
    sections: {
      'Role market': { evidence: [{ fact: 'f', date, url: 'https://example.com/source' }] },
    },
  };
  const r = researchDecode(['Role market'])(answer, true);
  validateResearch(r, ['Role market']);
  assert.ok(r.sections['Role market'].includes(date), 'must retain original date precision');
}
for (const date of ['2026-13', '2026-02-30', '2026-00', 'September', 'NONE'])
  assert.equal(validEvidenceDate(date), false, date);
// Empty evidence array is a valid "nothing found" shape.
assert.ok(
  sameShape({ limitations: 'NONE', sections: { 'Role market': { evidence: [] } } }, marketTemplate),
);
assert.equal(
  researchDecode(['Role market'])(
    { limitations: 'NONE', sections: { 'Role market': { evidence: [] } } },
    true,
  ).sections['Role market'],
  null,
);

const companyPrompt = renderPrompt(root, 'eval/company-research.md', {
  COMPANY: 'Acme',
  EMPLOYER_URLS: 'https://acme.example',
  EXISTING_CACHE: 'none',
  DATE: '2026-09-18',
});
const companyTemplate = extractWorksheetJSON(companyPrompt);
assert.deepEqual(Object.keys(companyTemplate.sections), [
  'Company Reputation & Culture',
  'Layoffs & Hiring Signals',
]);
const companyAnswer = {
  limitations: 'Second section unavailable',
  sections: {
    'Company Reputation & Culture': {
      evidence: [
        {
          fact: 'Quoted "employee" evidence\nA second line',
          date: '2026-09',
          url: 'https://example.com/source',
        },
      ],
    },
    'Layoffs & Hiring Signals': { evidence: [] },
  },
};
assert.ok(sameShape(companyAnswer, companyTemplate));
const decodedCompany = researchDecode(['Company Reputation & Culture', 'Layoffs & Hiring Signals'])(
  companyAnswer,
  true,
);
assert.ok(
  decodedCompany.sections['Company Reputation & Culture'].includes('https://example.com/source'),
);
assert.equal(decodedCompany.sections['Layoffs & Hiring Signals'], null);
validateResearch(decodedCompany, ['Company Reputation & Culture', 'Layoffs & Hiring Signals']);

const evaluatePrompt = renderPrompt(root, 'eval/evaluate.md', {
  SCORING_RUBRIC: 'r',
  CANDIDATE_FACTS: 'c',
  TARGETING: 't',
  COMPANY: 'Acme',
  ROLE: 'Engineer',
  DATE: '2026-09-18',
  JOB_DESCRIPTION: 'jd text',
  MARKET_SALARY_CONTEXT: 'salary context',
  SCAN_HISTORY: 'sh text',
});
const evalTemplate = extractWorksheetJSON(evaluatePrompt);
assert.deepEqual(
  Object.keys(evalTemplate.scores),
  dimensions,
  'evaluate.md dimension keys must match the JS dimensions list exactly',
);
assert.equal(
  evalTemplate.requirements.length,
  1,
  'template shows one example requirement row, decode() enforces the 1-10 target with limited tolerance',
);
assert.equal(evalTemplate.customization_plan.cv_changes.length, 5);
assert.ok(!('linkedin_changes' in evalTemplate.customization_plan));

const scores = Object.fromEntries(
  dimensions.map(d => [d, { score: 4, evidence: 'Verified evidence' }]),
);
const fullAnswer = {
  legitimacy: 'High Confidence',
  verdict: 'Good fit',
  scores,
  role_summary: {
    archetype: 'a',
    domain: 'd',
    function: 'f',
    seniority: 's',
    location: 'l',
    team: 't',
    summary: 'sum',
  },
  requirements: [
    { requirement: 'Req 1', evidence: 'Ev 1', match: 'Met', mitigation: 'NONE' },
    { requirement: 'Req 2', evidence: 'Ev 2', match: 'Gap', mitigation: 'Learn X' },
  ],
  level_and_strategy: { level: 'l', positioning: 'p', downlevel: 'd', floor: 'f' },
  comp_and_demand: {
    band: 'CAD $100,000-$120,000 base',
    band_min: '100000',
    band_max: '120000',
    band_currency: 'NONE',
    estimate_min: 'NONE',
    estimate_max: 'NONE',
  },
  customization_plan: { cv_changes: ['1', '2', '3', '4', '5'] },
  posting_legitimacy: { quality: 'q', stale: 's', assessment: 'a' },
  keywords: Array.from({ length: 15 }, (_, i) => 'term' + i),
};
assert.ok(sameShape(fullAnswer, evalTemplate));
const result = validateEvaluation(evaluationDecode(dimensions)(fullAnswer));
assert.equal(result.scores.length, 8);
assert.equal(
  result.compensationBand,
  '$100,000 - $120,000',
  'known band renders as plain digits with no currency/base-pay text',
);

// formatCompensation() is the single place that turns worksheet fields into
// the dashboard-facing compensation string — exercise its display rules directly.
assert.equal(
  formatCompensation({ band_min: '100000', band_max: '120000', band_currency: 'NONE' }),
  '$100,000 - $120,000',
);
assert.equal(
  formatCompensation({ band_min: '100000', band_max: '120000', band_currency: 'USD' }),
  '$100,000 - $120,000 USD',
);
assert.equal(
  formatCompensation({
    band_min: 'UNKNOWN',
    band_max: 'UNKNOWN',
    estimate_min: '115000',
    estimate_max: '140000',
  }),
  '$115,000 - $140,000 estimated',
);
// An hourly rate the model failed to annualize is converted at 40 h x 52.
assert.equal(
  formatCompensation({ band_min: '53', band_max: '60.5', band_currency: 'NONE' }),
  '$110,240 - $125,840',
);
assert.equal(
  formatCompensation({ band_min: 'UNKNOWN', band_max: 'UNKNOWN' }),
  'UNKNOWN — JD lists no band and no market estimate available',
);
assert.throws(
  () =>
    evaluationDecode(dimensions)({
      ...fullAnswer,
      comp_and_demand: {
        band: 'UNKNOWN',
        band_min: 'UNKNOWN',
        band_max: 'UNKNOWN',
        band_currency: 'NONE',
        estimate_min: 'UNKNOWN',
        estimate_max: 'UNKNOWN',
      },
    }),
  /requires numeric estimate_min and estimate_max/,
);
assert.ok(result.blocks.E.startsWith('| Priority | CV change |'));
assert.ok(
  result.blocks.B.startsWith('| JD Requirement | CV Evidence | Match / Gap | Mitigation |'),
);
assert.equal(result.blocks.B.split('\n').length, 4, 'header, separator, and two requirement rows');

assert.throws(
  () => evaluationDecode(dimensions)({ ...fullAnswer, requirements: [] }),
  /requirements needs 1-12 rows/,
);
assert.doesNotThrow(() =>
  evaluationDecode(dimensions)({
    ...fullAnswer,
    requirements: Array.from({ length: 12 }, () => fullAnswer.requirements[0]),
  }),
);
assert.throws(
  () =>
    evaluationDecode(dimensions)({
      ...fullAnswer,
      requirements: Array.from({ length: 13 }, () => fullAnswer.requirements[0]),
    }),
  /requirements needs 1-12 rows/,
);
assert.doesNotThrow(() =>
  evaluationDecode(dimensions)({
    ...fullAnswer,
    customization_plan: { cv_changes: ['1', '2', '3', '4', '5', '6'] },
  }),
);
assert.throws(
  () => evaluationDecode(dimensions)({ ...fullAnswer, customization_plan: { cv_changes: ['1'] } }),
  /needs 5-6/,
);
assert.throws(
  () =>
    evaluationDecode(dimensions)({
      ...fullAnswer,
      requirements: [{ requirement: 'long '.repeat(501), evidence: 'e', match: 'Gap' }],
    }),
  /500 words/,
);
assert.doesNotThrow(() =>
  evaluationDecode(dimensions)({
    ...fullAnswer,
    keywords: Array.from({ length: 22 }, (_, i) => 'term' + i),
  }),
);
assert.throws(
  () =>
    evaluationDecode(dimensions)({
      ...fullAnswer,
      keywords: Array.from({ length: 23 }, (_, i) => 'term' + i),
    }),
  /keywords needs 15-22/,
);
assert.throws(
  () => evaluationDecode(dimensions)({ ...fullAnswer, keywords: ['only', 'a', 'few'] }),
  /keywords needs 15-22/,
);

console.log(
  'Worksheet tests passed: every field is literal JSON in the .md prompts, shape checking, quotes/newlines, partial sources and code-owned report tables.',
);
