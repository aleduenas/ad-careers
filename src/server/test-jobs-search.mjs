import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSearch, MAX_SEARCH_DEPTH, MAX_SEARCH_TERMS, parseSearch } from './jobs-search.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const term = value => ({ type: 'term', value });
const tree = q => {
  const parsed = parseSearch(q);
  assert.equal(parsed.mode, 'boolean', q);
  return parsed.tree;
};
const error = q => {
  const parsed = parseSearch(q);
  assert.ok(parsed.error, `${q} should be invalid`);
  return parsed.error;
};

test('plain text with no capital operator, quote or parenthesis is one literal needle', () => {
  for (const q of [
    '',
    'senior',
    'senior engineer',
    'and or not',
    'a-b_c%',
    'Café 🚀',
    '  padded  ',
  ]) {
    assert.deepEqual(parseSearch(q), { mode: 'plain', term: q }, JSON.stringify(q));
  }
  // Lowercase operators stay ordinary words; so do operators glued to other characters.
  assert.equal(parseSearch('cats and dogs').mode, 'plain');
  assert.equal(parseSearch('ANDROID NOTES ORACLE').mode, 'plain');
});

test('terms, quoted phrases and the three operators', () => {
  assert.deepEqual(tree('"senior engineer"'), term('senior engineer'));
  assert.deepEqual(tree('a AND b'), { type: 'and', children: [term('a'), term('b')] });
  assert.deepEqual(tree('a OR b'), { type: 'or', children: [term('a'), term('b')] });
  assert.deepEqual(tree('NOT a'), { type: 'not', child: term('a') });
  assert.deepEqual(tree('NOT "a b"'), { type: 'not', child: term('a b') });
  assert.deepEqual(tree('NOT NOT a'), { type: 'not', child: { type: 'not', child: term('a') } });
  // Operators inside quotes are text; lowercase operators outside are terms.
  assert.deepEqual(tree('"a AND b"'), term('a AND b'));
  assert.deepEqual(tree('a and b AND c'), {
    type: 'and',
    children: [term('a'), term('and'), term('b'), term('c')],
  });
});

test('precedence is NOT, then AND, then OR; side by side terms mean AND', () => {
  assert.deepEqual(tree('a OR b AND c'), {
    type: 'or',
    children: [term('a'), { type: 'and', children: [term('b'), term('c')] }],
  });
  assert.deepEqual(tree('NOT a AND b'), {
    type: 'and',
    children: [{ type: 'not', child: term('a') }, term('b')],
  });
  assert.deepEqual(tree('a OR NOT b OR c'), {
    type: 'or',
    children: [term('a'), { type: 'not', child: term('b') }, term('c')],
  });
  assert.deepEqual(tree('"x y" z'), { type: 'and', children: [term('x y'), term('z')] });
  assert.deepEqual(tree('a NOT b'), {
    type: 'and',
    children: [term('a'), { type: 'not', child: term('b') }],
  });
  assert.deepEqual(tree('a (b OR c)'), {
    type: 'and',
    children: [term('a'), { type: 'or', children: [term('b'), term('c')] }],
  });
});

test('parentheses group and nest', () => {
  assert.deepEqual(tree('("security" AND "AI")'), {
    type: 'and',
    children: [term('security'), term('AI')],
  });
  assert.deepEqual(tree('(a OR b) AND c'), {
    type: 'and',
    children: [{ type: 'or', children: [term('a'), term('b')] }, term('c')],
  });
  assert.deepEqual(tree('NOT (a OR b)'), {
    type: 'not',
    child: { type: 'or', children: [term('a'), term('b')] },
  });
  assert.deepEqual(tree('((a))'), term('a'));
  // Parentheses touching words or quotes still split tokens.
  assert.deepEqual(tree('(a)AND(b)'), { type: 'and', children: [term('a'), term('b')] });
});

test('every invalid expression has a plain-words message', () => {
  assert.equal(error('(a'), 'Missing closing parenthesis.');
  assert.equal(error('Alpha AND ('), 'Missing closing parenthesis.');
  assert.equal(error('('), 'Missing closing parenthesis.');
  assert.equal(error('((a) OR b'), 'Missing closing parenthesis.');
  assert.equal(error('a)'), 'Unexpected closing parenthesis.');
  assert.equal(error(')'), 'Unexpected closing parenthesis.');
  assert.equal(error('"abc'), 'Missing closing quote.');
  assert.equal(error('a "b'), 'Missing closing quote.');
  assert.equal(error('""'), 'A quoted phrase cannot be empty.');
  assert.equal(error('()'), 'Empty parentheses.');
  assert.equal(error('a AND'), 'AND needs a search term after it.');
  assert.equal(error('a OR'), 'OR needs a search term after it.');
  assert.equal(error('NOT'), 'NOT needs a search term after it.');
  assert.equal(error('a AND AND b'), 'AND needs a search term after it.');
  assert.equal(error('a AND OR b'), 'AND needs a search term after it.');
  assert.equal(error('AND a'), 'AND needs a search term before it.');
  assert.equal(error('OR a'), 'OR needs a search term before it.');
  assert.equal(error('(OR a)'), 'OR needs a search term before it.');
  assert.equal(error('a OR OR b'), 'OR needs a search term after it.');
  assert.equal(error('NOT AND a'), 'NOT needs a search term after it.');
});

test('bounds: at most 20 terms and 5 levels of parentheses', () => {
  const terms = n => Array.from({ length: n }, (_, i) => `t${i}`);
  assert.equal(parseSearch(terms(MAX_SEARCH_TERMS).join(' OR ')).mode, 'boolean');
  assert.equal(
    error(terms(MAX_SEARCH_TERMS + 1).join(' OR ')),
    `Use at most ${MAX_SEARCH_TERMS} search terms.`,
  );
  const nest = depth => '('.repeat(depth) + 'a' + ')'.repeat(depth);
  assert.equal(parseSearch(nest(MAX_SEARCH_DEPTH)).mode, 'boolean');
  assert.equal(
    error(nest(MAX_SEARCH_DEPTH + 1)),
    `Nest parentheses at most ${MAX_SEARCH_DEPTH} levels deep.`,
  );
});

test('compileSearch evaluates plain and boolean searches with the given term matcher', () => {
  const rows = [
    { id: 1, text: 'senior security ai' },
    { id: 2, text: 'junior security' },
    { id: 3, text: 'staff ai' },
  ];
  const termMatches = (row, value) => row.text.includes(value);
  const ids = q => rows.filter(compileSearch(parseSearch(q), termMatches)).map(row => row.id);
  assert.deepEqual(ids(''), [1, 2, 3]);
  assert.deepEqual(ids('security ai'), [1], 'plain text is one substring');
  assert.deepEqual(ids('security AND ai'), [1]);
  assert.deepEqual(ids('security OR ai'), [1, 2, 3]);
  assert.deepEqual(ids('NOT "senior"'), [2, 3]);
  assert.deepEqual(ids('("security" AND "ai") OR staff'), [1, 3]);
  assert.deepEqual(ids('security NOT ai'), [2]);
  assert.deepEqual(ids('NOT (security OR ai)'), []);
});
