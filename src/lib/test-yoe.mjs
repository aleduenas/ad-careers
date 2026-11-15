import assert from 'node:assert/strict';
import {
  yoeColumns,
  yoeForJob,
  estimateYoe,
  inferLevel,
  normalizeText,
  MAX_INPUT_CHARS,
  LEVEL_TABLE,
} from './yoe.mjs';

process.env.CAREER_OPS_TEST_GUARD = '1';

const mins = (text, opts) => estimateYoe(text, opts).mentions.map(m => [m.min, m.max]);
const head = (text, opts) => {
  const { headline } = estimateYoe(text, opts);
  return [headline.min, headline.max];
};
const noMention = text => {
  const r = estimateYoe(text);
  assert.deepEqual(r.mentions, [], text);
  assert.equal(r.headline.source, 'none', text);
};

// Wording: digits, number words, plus signs and ranges.
assert.deepEqual(mins('5+ years of experience in Go'), [[5, null]]);
assert.deepEqual(mins('5 + years of experience'), [[5, null]]);
assert.deepEqual(mins('3-5 years of experience'), [[3, 5]]);
assert.deepEqual(mins('3 to 5 years of experience'), [[3, 5]]);
assert.deepEqual(mins('3–5 years of experience'), [[3, 5]]);
assert.deepEqual(mins('8-10+ years of experience'), [[8, null]]);
assert.deepEqual(mins('At least 2 years of experience'), [[2, null]]);
assert.deepEqual(mins('Minimum of 3+ years in testing'), [[3, null]]);
assert.deepEqual(mins('Minimum (of) 3 years in testing'), [[3, null]]);
assert.deepEqual(mins('Min. 3 years in testing'), [[3, null]]);
assert.deepEqual(mins('Over 5 years in support'), [[5, null]]);
assert.deepEqual(mins('More than 5 years in support'), [[5, null]]);
assert.deepEqual(mins('5 or more years in support'), [[5, null]]);
assert.deepEqual(mins('Up to 3 years of experience is fine'), [[0, 3]]);
assert.deepEqual(mins('Five years of experience'), [[5, 5]]);
assert.deepEqual(mins('five (5) years of experience'), [[5, 5]]);
assert.deepEqual(mins('two to four years of experience'), [[2, 4]]);
assert.deepEqual(mins('4 yrs of experience'), [[4, 4]]);
assert.deepEqual(mins('4 yr experience'), [[4, 4]]);
assert.deepEqual(mins("3+ years' experience in testing"), [[3, null]]);
assert.deepEqual(mins('5+ YOE in testing'), [[5, null]]);
assert.deepEqual(mins('Experience: 5+ years'), [[5, null]]);
assert.deepEqual(mins('Python (5+ years)'), [[5, null]]);
assert.deepEqual(mins('A 5-year track record in sales'), [[5, 5]]);
assert.deepEqual(mins('8?10+ years of consulting'), [[8, null]]);

// Markdown and bold markers do not break a match.
assert.deepEqual(mins('- **5+ years** of **Python** experience'), [[5, null]]);
assert.deepEqual(mins('* __3-5 years__ in sales'), [[3, 5]]);
assert.deepEqual(mins('- [5+ years](https://example.invalid) of experience'), [[5, null]]);
assert.deepEqual(mins('5\\+ years of experience'), [[5, null]]);

assert.deepEqual(mins('5&#43;&#160;years of experience'), [[5, null]]);
assert.deepEqual(mins('3 &#8211; 5 years of experience'), [[3, 5]]);

// Subjects.
{
  const sub = text => estimateYoe(text).mentions[0].subject;
  assert.equal(sub('7+ years in security engineering or related roles'), 'security engineering');
  assert.equal(sub('5+ years of professional Python programming experience'), 'Python programming');
  assert.equal(sub('2+ years experience as a Data Engineer'), 'Data Engineer');
  assert.equal(sub('Experience with Kubernetes: 4+ years'), 'Kubernetes');
  assert.equal(sub('Python (5+ years)'), 'Python');
  assert.equal(sub('Python experience: 5+ years'), 'Python');
  assert.equal(sub('3+ years focused on machine learning systems'), 'machine learning systems');
  assert.equal(sub('Minimum 3 years'), '');
}

// Several figures.
{
  const r = estimateYoe('10 years in computers and 3 in AI.');
  assert.deepEqual(
    r.mentions.map(m => [m.min, m.subject]),
    [
      [10, 'computers'],
      [3, 'AI'],
    ],
  );
  assert.equal(r.headline.min, 10);
  assert.ok(r.flags.includes('multiple'));
  assert.equal(r.headline.confidence, 'medium');

  const t = estimateYoe('9 years total including 5 in security.');
  assert.equal(t.headline.min, 9);
  assert.ok(t.flags.includes('total') && t.flags.includes('multiple'));
  assert.deepEqual(
    t.mentions.map(m => m.min),
    [9, 5],
  );

  const bullets = estimateYoe('- 6+ years in sales\n- 3+ years in marketing\n- 8+ years in all');
  assert.equal(bullets.headline.min, 8);
  assert.equal(bullets.mentions.length, 3);

  const dup = estimateYoe('5+ years in Go.\n5+ years in Go.');
  assert.equal(dup.mentions.length, 1);
  assert.ok(!dup.flags.includes('multiple'));
}

// Single clear requirement: high confidence, no extra flags besides open or range.
{
  const r = estimateYoe('You have 5+ years of experience in data engineering.');
  assert.equal(r.headline.source, 'stated');
  assert.equal(r.headline.confidence, 'high');
  assert.ok(!r.flags.includes('multiple'));
  assert.ok(r.mentions[0].text.includes('5+ years'));
  assert.ok(estimateYoe('3-5 years of experience').flags.includes('range'));
}

// Degree ladders and alternatives: the plain result, flagged, with low confidence.
{
  const r = estimateYoe("Bachelor's with 8 years, Master's with 6 years, PhD with 3 years.");
  assert.ok(r.flags.includes('alternatives'));
  assert.equal(r.mentions.length, 3);
  assert.equal(r.headline.min, 8);
  assert.equal(r.headline.confidence, 'low');
  const w = estimateYoe('A degree plus 5 years of experience, or 9 years without a degree.');
  assert.ok(w.flags.includes('alternatives'));
  assert.equal(w.headline.min, 9);
  assert.equal(w.headline.confidence, 'low');
  // One degree and one figure is not an alternative.
  const one = estimateYoe("Bachelor's degree and 5+ years of experience in sales.");
  assert.ok(!one.flags.includes('alternatives'));
  assert.equal(one.headline.min, 5);
}

// Preferred figures never set the headline unless nothing is required.
{
  const r = estimateYoe(
    '## Requirements\n- 3+ years in testing\n\n## Nice to have\n- 8+ years in leadership',
  );
  assert.equal(r.headline.min, 3);
  assert.deepEqual(
    r.mentions.map(m => m.kind),
    ['required', 'preferred'],
  );
  const inline = estimateYoe('3+ years in testing. Ideally 7 years in cloud, which is a plus.');
  assert.equal(inline.headline.min, 3);
  assert.equal(inline.mentions[1].kind, 'preferred');
  for (const phrase of [
    '5+ years of Go is a plus',
    'Ideally 5+ years of Go',
    '5+ years of Go (preferred)',
    '5+ years of Go would be an asset',
    '5+ years of Go, nice to have',
  ]) {
    assert.equal(estimateYoe(phrase).mentions[0].kind, 'preferred', phrase);
  }
  for (const heading of ['## Bonus Points', '**Assets**', 'Preferred:']) {
    const h = estimateYoe(`${heading}\n- 5+ years of Go`);
    assert.equal(h.mentions[0].kind, 'preferred', heading);
  }
  const only = estimateYoe('## Nice to have\n- 4+ years of Rust');
  assert.equal(only.headline.min, 4);
  assert.equal(only.headline.confidence, 'low');
  assert.ok(only.flags.includes('preferred-only'));
  // A heading that sets preferred ends at the next heading.
  const back = estimateYoe('## Preferred\n- 1+ year of Go\n## Requirements\n- 6+ years of Java');
  assert.deepEqual(
    back.mentions.map(m => m.kind),
    ['preferred', 'required'],
  );
  // A semicolon run does not leak a later marker onto an earlier requirement.
  const run = estimateYoe('5+ years in sales; strong SQL; Preferred: PhD');
  assert.equal(run.mentions[0].kind, 'required');
}

// Traps.
noMention('We have been in business for over 55 years.');
noMention('Founded in 1970, we have served clients for 25 years.');
noMention('Our team has 100 years of combined history.');
noMention('Recognition at 3, 5, 7, and 10 years.');
noMention('Enjoy a sabbatical after 5 years with the company.');
noMention('Stock options with a four-year vesting period.');
noMention('A 12 month contract role.');
noMention('This is a 2-year term position.');
noMention('A fixed term of 2 years.');
noMention('You hold a 3-year diploma or a 4-year degree.');
noMention('Candidates must be 18 years of age or older.');
noMention('Applicants must be 18 years old.');
noMention('We have grown quickly in recent years.');
noMention('We started this 5 years ago.');
noMention('Over the next 3 years we will double in size.');
noMention('You have lived in Canada for the last 5 years.');
noMention('Our 3 year roadmap is ambitious.');
noMention('Salary range $90,000 for 5 years of seniority bands.');
noMention('Pension plan vests after 2 years.');
noMention('Over 150 years of history.');
noMention('A bachelor degree (4 years) is required.');
noMention('Employees are celebrated at their 5 year anniversary.');
{
  // The trap does not hide a real requirement in the same text.
  const r = estimateYoe(
    'We have been in business for over 55 years. You need 4+ years of experience.',
  );
  assert.deepEqual(
    r.mentions.map(m => m.min),
    [4],
  );
  // Experience wording with a degree in the same sentence is kept.
  assert.deepEqual(mins('A 4-year degree and 3 years of experience in Python'), [[3, 3]]);
  // Benefit headings drop figures that carry no experience wording.
  assert.deepEqual(mins('## Benefits\n- Extra vacation after 3 years\n- Learning budget'), []);
  // A company claim with experience wording but a candidate cue stays.
  assert.deepEqual(mins('You bring over 6 years of experience in finance.'), [[6, null]]);
}

// Title inference.
{
  assert.deepEqual(head('No years are given here.', { title: 'Senior Data Engineer' }), [5, 8]);
  assert.equal(
    estimateYoe('x', { title: 'Senior Data Engineer' }).headline.source,
    'inferred-title',
  );
  assert.equal(estimateYoe('x', { title: 'Senior Data Engineer' }).headline.confidence, 'low');
  assert.deepEqual(head('x', { title: 'Junior Analyst' }), [0, 2]);
  assert.deepEqual(head('x', { title: 'Software Engineering Intern' }), [0, 1]);
  assert.deepEqual(head('x', { title: 'Staff Engineer' }), [8, 12]);
  assert.deepEqual(head('x', { title: 'Principal Scientist' }), [12, 20]);
  assert.deepEqual(head('x', { title: 'Associate Director of Data' }), [12, 20]);
  assert.deepEqual(head('x', { title: 'Data Engineer II' }), [2, 5]);
  assert.equal(estimateYoe('x', { title: 'Data Engineer' }).headline.source, 'none');
  // The first heading is used when no title is passed.
  assert.deepEqual(head('# Senior Security Engineer\n\nJoin us.'), [5, 8]);
  assert.deepEqual(head('Title: Junior Developer\nJoin us.'), [0, 2]);
  // Stated figures win over the title.
  const stated = estimateYoe('2+ years of experience', { title: 'Principal Engineer' });
  assert.equal(stated.headline.source, 'stated');
  assert.equal(stated.headline.min, 2);
  assert.equal(inferLevel('Mid-level Engineer').level, 'intermediate');
  assert.equal(inferLevel('Engineer'), null);
  assert.ok(LEVEL_TABLE.length >= 6);
}

// Degenerate input.
for (const empty of ['', '   ', null, undefined, '\n\n']) {
  const r = estimateYoe(empty);
  assert.deepEqual(r, {
    headline: { min: null, max: null, source: 'none', confidence: 'low' },
    mentions: [],
    flags: [],
  });
}
assert.equal(normalizeText('a **bold** b').trim(), 'a bold b');
{
  // Very long input: bounded and fast; text beyond the cap is not scanned.
  const filler = 'lorem ipsum dolor sit amet '.repeat(40_000);
  const started = Date.now();
  const r = estimateYoe(`${filler}\n5+ years of Go`);
  assert.equal(r.headline.source, 'none');
  const tail = estimateYoe(`2+ years of Go\n${filler}\n9+ years of Rust`);
  assert.deepEqual(
    tail.mentions.map(m => m.min),
    [2],
  );
  const noSpaces = estimateYoe('9'.repeat(MAX_INPUT_CHARS * 2));
  assert.equal(noSpaces.headline.source, 'none');
  const dense = estimateYoe('5 years, '.repeat(6000));
  assert.ok(dense.mentions.length <= 1);
  assert.ok(Date.now() - started < 3000, 'long input stays fast');
}

// Label form: the figure follows "years of experience:".
assert.deepEqual(mins('Years of experience: 5-7'), [[5, 7]]);
assert.deepEqual(mins('Years of relevant experience: 3+'), [[3, null]]);

// Column mapping: the two job_descriptions values.
assert.deepEqual(yoeColumns(estimateYoe('You need 5+ years of experience.')), {
  yoe_min: 5,
  yoe_confidence: 'high',
});
assert.deepEqual(yoeColumns(estimateYoe('3+ years in A. 2+ years in B.')), {
  yoe_min: 3,
  yoe_confidence: 'medium',
});
assert.deepEqual(yoeColumns(estimateYoe('x', { title: 'Senior Engineer' })), {
  yoe_min: 5,
  yoe_confidence: 'inferred',
});
assert.deepEqual(yoeColumns(estimateYoe('nothing here')), { yoe_min: null, yoe_confidence: null });
assert.deepEqual(yoeColumns(null), { yoe_min: null, yoe_confidence: null });
assert.deepEqual(yoeForJob('5+ years of Go', 'Senior Engineer'), {
  yoe_min: 5,
  yoe_confidence: 'high',
});
assert.deepEqual(
  yoeForJob(
    {
      toString() {
        throw new Error('boom');
      },
    },
    'x',
  ),
  {
    yoe_min: null,
    yoe_confidence: null,
  },
);

console.log('yoe tests passed');
