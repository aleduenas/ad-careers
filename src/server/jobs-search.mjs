// Boolean search expressions for the jobs list `q` parameter (D115). Pure: no database, no I/O.
//
// A `q` with no parenthesis, no double quote and no standalone capital AND, OR or NOT is "plain":
// the whole string is one substring needle, exactly as before. Anything else is parsed as
//   or  := and ( "OR" and )*
//   and := not ( ["AND"] not )*        two terms side by side mean AND
//   not := "NOT" not | "(" or ")" | term
// where a term is a bare word or a "quoted phrase". Operators are capitals only.
//
// parseSearch returns { mode: 'plain', term } | { mode: 'boolean', tree } | { error: message }.
// Trees are { type: 'term', value } | { type: 'not', child } | { type: 'and'|'or', children }.

export const MAX_SEARCH_TERMS = 20;
export const MAX_SEARCH_DEPTH = 5;

const OPERATORS = new Set(['AND', 'OR', 'NOT']);

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '(' || char === ')') {
      tokens.push({ type: char });
      index += 1;
    } else if (char === '"') {
      const end = text.indexOf('"', index + 1);
      if (end < 0) return { error: 'Missing closing quote.' };
      const value = text.slice(index + 1, end);
      if (!value.trim()) return { error: 'A quoted phrase cannot be empty.' };
      tokens.push({ type: 'term', value });
      index = end + 1;
    } else {
      let end = index;
      while (end < text.length && !/[\s()"]/.test(text[end])) end += 1;
      const word = text.slice(index, end);
      tokens.push(OPERATORS.has(word) ? { type: word } : { type: 'term', value: word });
      index = end;
    }
  }
  return { tokens };
}

export function parseSearch(q) {
  const text = typeof q === 'string' ? q : '';
  const lexed = tokenize(text);
  // An unclosed quote only matters once the text is known to be an expression; a lone quote is
  // an expression too (quotes are never plain), so report it.
  if (lexed.error) return { error: lexed.error };
  const { tokens } = lexed;
  const plain = !tokens.some(token => token.type !== 'term') && !text.includes('"');
  if (plain) return { mode: 'plain', term: text };

  let position = 0;
  let terms = 0;
  let error = null;
  const fail = message => {
    error ??= message;
    return null;
  };
  const peek = () => tokens[position]?.type;

  function parseOr(depth) {
    const children = [];
    const first = parseAnd(depth);
    if (!first) return null;
    children.push(first);
    while (peek() === 'OR') {
      position += 1;
      const next = parseAnd(depth, 'OR');
      if (!next) return null;
      children.push(next);
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  function parseAnd(depth, after) {
    const children = [];
    const first = parseNot(depth, after);
    if (!first) return null;
    children.push(first);
    for (;;) {
      const next = peek();
      if (next === 'AND') {
        position += 1;
        const operand = parseNot(depth, 'AND');
        if (!operand) return null;
        children.push(operand);
      } else if (next === 'term' || next === 'NOT' || next === '(') {
        const operand = parseNot(depth);
        if (!operand) return null;
        children.push(operand);
      } else break;
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  function parseNot(depth, after) {
    if (peek() === 'NOT') {
      position += 1;
      const child = parseNot(depth, 'NOT');
      return child ? { type: 'not', child } : null;
    }
    return parsePrimary(depth, after);
  }

  function parsePrimary(depth, after) {
    const token = tokens[position];
    if (!token) {
      if (after) return fail(`${after} needs a search term after it.`);
      return fail('The search is empty.');
    }
    if (token.type === 'term') {
      position += 1;
      terms += 1;
      if (terms > MAX_SEARCH_TERMS) return fail(`Use at most ${MAX_SEARCH_TERMS} search terms.`);
      return { type: 'term', value: token.value };
    }
    if (token.type === '(') {
      if (depth + 1 > MAX_SEARCH_DEPTH)
        return fail(`Nest parentheses at most ${MAX_SEARCH_DEPTH} levels deep.`);
      position += 1;
      if (peek() === ')') return fail('Empty parentheses.');
      if (peek() === undefined) return fail('Missing closing parenthesis.');
      const inner = parseOr(depth + 1);
      if (!inner) return null;
      if (peek() !== ')') return fail('Missing closing parenthesis.');
      position += 1;
      return inner;
    }
    if (token.type === ')') return fail('Unexpected closing parenthesis.');
    // AND or OR where a term should be.
    return fail(
      after
        ? `${after} needs a search term after it.`
        : `${token.type} needs a search term before it.`,
    );
  }

  const tree = parseOr(0);
  if (!tree) return { error: error ?? 'The search is not valid.' };
  if (position < tokens.length) {
    return {
      error:
        tokens[position].type === ')'
          ? 'Unexpected closing parenthesis.'
          : 'The search is not valid.',
    };
  }
  return { mode: 'boolean', tree };
}

// Builds a predicate over a function that says whether one term matches a row.
export function compileSearch(parsed, termMatches) {
  if (parsed.mode === 'plain') return row => !parsed.term || termMatches(row, parsed.term);
  const build = node => {
    if (node.type === 'term') return row => termMatches(row, node.value);
    if (node.type === 'not') {
      const child = build(node.child);
      return row => !child(row);
    }
    const children = node.children.map(build);
    return node.type === 'and'
      ? row => children.every(child => child(row))
      : row => children.some(child => child(row));
  };
  return build(parsed.tree);
}
