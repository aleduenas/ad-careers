// Deterministic years-of-experience estimate for a job description. No LLM, no I/O.
//
// Three general pieces: one number-and-unit matcher, one test for "is this figure about the
// candidate's experience" (short negative word lists around the figure), and one required or
// preferred classifier (section headings plus nearby marker words). Hard cases are not special
// cased: they return the plain result with a flag and lower confidence.

// Only this much text is scanned; sentences longer than MAX_SEGMENT are chunked.
export const MAX_INPUT_CHARS = 60_000;
const MAX_SEGMENT = 1_500;
const MAX_YEARS = 25;

// Title inference. First matching row wins, so the most senior words come first.
export const LEVEL_TABLE = [
  {
    level: 'principal',
    min: 12,
    max: 20,
    re: /\b(?:principal|distinguished|fellow|director|head of|vp|vice president|chief)\b/i,
  },
  { level: 'staff', min: 8, max: 12, re: /\b(?:staff|lead)\b/i },
  { level: 'senior', min: 5, max: 8, re: /\b(?:senior|sr|iii|level 3)\b/i },
  { level: 'intermediate', min: 2, max: 5, re: /\b(?:intermediate|mid|mid-level|ii|level 2)\b/i },
  {
    level: 'junior',
    min: 0,
    max: 2,
    re: /\b(?:junior|jr|entry|entry-level|associate|graduate|new grad|trainee|apprentice)\b/i,
  },
  { level: 'intern', min: 0, max: 1, re: /\b(?:intern|internship|co-op|coop|student)\b/i },
];

const WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
const WORD_VALUE = Object.fromEntries(WORDS.split('|').map((w, i) => [w, i + 1]));
const NUM = `(?:\\d{1,4}(?:\\.\\d{1,2})?|(?:${WORDS})\\b)`;
const PLUS = '(?:\\+|plus\\b|or\\s+more\\b|or\\s+greater\\b)';
// "5", "5+", "3-5", "3 to 5", "8-10+", then years/yrs/yoe (also "5-year"). Linear on bounded text.
const YEARS_RE = new RegExp(
  `(?<![\\w.,$/#])(?<!\\w-)(${NUM})(?:\\s*(${PLUS}))?(?:\\s*(?:-|to)\\s*(${NUM})(?:\\s*(${PLUS}))?)?\\s*-?\\s*(years?|yrs?|yoe)\\b`,
  'gi',
);
// "10 years in computers and 3 in AI": a bare number after a connector.
const FOLLOW_RE = new RegExp(
  `(?:,|;|&|\\band\\b|\\bplus\\b|\\bincluding\\b|\\bwith\\b)\\s*(?:at least\\s+)?(${NUM})\\s*(${PLUS})?\\s+(?:of (?:which|those)\\s+)?(?:in|with|on|using)\\s+([^,;.()]{1,60})`,
  'gi',
);
// "Years of experience: 5-7" is rewritten to "5-7 years of experience" before matching.
const LABEL_FORM = new RegExp(
  `\\b(?:years?|yrs?)\\s+of\\s+((?:\\w+\\s+){0,3}?experience)\\s*:\\s*(${NUM}(?:\\s*${PLUS})?(?:\\s*(?:-|to)\\s*${NUM}(?:\\s*${PLUS})?)?)(?![\\w.])`,
  'gi',
);
const QUALIFIER_RE =
  /(?:^|[\s(,;:])(?:(?:a|the)\s+)?(at\s+least|a\s+minimum\s+of|minimum(?:\s+\(?of\)?)?|min|over|more\s+than|greater\s+than|upwards\s+of|up\s+to|maximum(?:\s+of)?|max|under|less\s+than|around|approximately|about|roughly|nearly|almost)\s*[:~-]?\s*$/i;

// Is this figure about the candidate's experience? Words that say it is not.
const LEFT_NOT =
  /\b(?:last|past|next|coming|following|previous|every|each|per|after|within|first|initial)\s+(?:\w+\s+)?$|\d\s*,\s*(?:and\s+|or\s+)?$|\b(?:contract|term|lease|warranty|probation|tenure)\s*(?:of|is|:|for)?\s*$|\b(?:degree|diploma|bachelor'?s?)\s*\(\s*$/i;
const RIGHT_NOT =
  /^[\s'-]*(?:ago\b|from now\b|later\b|old\b|(?:or |and )?older\b|of (?:age|service|history|operations?|study|education|university|college|innovation|excellence|growth|success)\b|in business\b|in operation\b|from (?:the )?(?:date|time|end|start)\b|to exercise\b|(?:over|on)[- ]year\b|(?:term|contract|lease|warranty|vesting|apprenticeship|anniversar\w*|milestone\w*)\b)/i;
// Only for the singular "5-year X" form, where X names a program or period, not experience.
const SINGULAR_NOT =
  /^[\s'-]*(?:\w+\s+)?(?:term|contract|lease|warranty|plan|roadmap|vision|strategy|program(?:me)?|diploma|degree|bachelor\w*|master\w*|college|university|undergraduate|post-?secondary|apprenticeship|horizon|cycle|agreement|assignment|probation|history|legacy|forecast|fixed)\b(?!\s+(?:manag|deliver|lead|office|execut|coordinat|analy|develop|director))/i;
// Benefit, pay and company-history words in the same clause, unless the clause speaks to the candidate.
const CLAUSE_NOT =
  /\b(?:anniversar\w*|sabbatical|vest\w*|years of service|recogni[sz]\w* (?:program|award|at)|founded|established|heritage|legacy|celebrat\w+|salary|compensation|pension|401\(?k\)?|rrsp|vacation|pto|stock|equity|world-?wide|megatrend|roadmap|eligib\w+ (?:after|at|for))\b|[$€£]/i;
const CANDIDATE =
  /\b(?:you|your|candidate|candidates|applicant|required|requirements?|must|minimum|at least|qualifications?|proven|demonstrated|looking for|seeking)\b/i;
const EXPERIENCE =
  /\b(?:experience|experienced|expertise|background|track record|proficien\w*|hands[- ]on|knowledge|exposure)\b/i;

const PREFERRED_HEADING =
  /\b(?:preferred|nice[- ]to[- ]haves?|bonus|assets?|desirable|good to have|great to have|extra credit|pluses|a plus|additional (?:skills|qualifications))\b/i;
const NOISE_HEADING =
  /^(?:benefits?|perks?|what we offer|compensation|total rewards|rewards|why (?:work|join)|life at|our culture|culture|about us|our story|our history|who we are|company (?:overview|history)|about the company|equal opportunity|diversity)\b/i;
const REQUIRED_HEADING =
  /\b(?:requirements?|qualifications?|must have|you bring|looking for|about you|minimum|basic|required|mandatory|essential|who you are|skills|experience|responsibilit\w+|the role|overview)\b/i;
const MARKER_RE =
  /\b(?:preferred|preferably|nice[- ]to[- ]haves?|an? plus|an? asset|an? bonus|bonus points?|ideally|desirable|beneficial|an? advantage|(?:is|are|be|would be)\s+(?:an?\s+)?(?:plus|asset|bonus|advantage)|optional|not required)\b/gi;
const ADVERB_MARKER = /^(?:ideally|preferably)$/i;

const DEGREE_RE =
  /\b(?:bachelor'?s?|bsc?|master'?s?|msc?|mba|ph\.?d|doctorate|associate'?s? degree|diploma|degree)\b/i;
const WITHOUT_RE = /\b(?:without|no degree)\b/i;

// Subject: the thing the years are in. Leading filler words are peeled, then cut at the first stop.
const LEAD_FILLER = new RegExp(
  `^(?:of|in|with|as|within|using|on|building|developing|designing|leading|managing|delivering|and|an?|the|focus(?:ed|ing)?\\s+(?:on|in)|experience|experienced|expertise|exp|track record|background|knowledge|proficiency|years?|previous|professional|relevant|hands[- ]on|practical|proven|industry|related|direct|prior|progressive|demonstrated|full[- ]time|recent|solid|strong|work|working|commercial|significant|substantial|extensive|real[- ]world|technical|similar)\\s+`,
  'i',
);
const SUBJECT_STOP = new RegExp(
  `\\s+(?:(?:and|or|plus)\\s+(?:\\d|${WORDS}\\b)|without|with|including|using|who|that|to|where|preferably|ideally|for|while|such as|like|which|or related|or similar|or equivalent|within|across|at|on|from|building|delivering|leading|managing|shipping|owning|designing|experience|expertise)\\b`,
  'i',
);

const valueOf = s =>
  Number.isFinite(Number(s)) ? Number(s) : (WORD_VALUE[String(s).toLowerCase()] ?? NaN);

// Clean Markdown, HTML entities and typographic noise. Keeps the line structure.
export function normalizeText(raw) {
  const named = { 160: ' ', 8239: ' ', 8211: '-', 8212: '-', 8216: "'", 8217: "'" };
  return String(raw ?? '')
    .slice(0, MAX_INPUT_CHARS)
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]{0,2000}?\n---\n/, '')
    .replace(/[   ​-‍﻿]/g, ' ')
    .replace(/[‘’ʼ´]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/`/g, '')
    .replace(/\[([^\]\n]{0,200})\]\([^)\n]{0,500}\)/g, '$1')
    .replace(/<[^>\n]{1,200}>/g, ' ')
    .replace(/&#(\d{2,5});/g, (_, n) => named[n] ?? (n < 256 ? String.fromCharCode(n) : ' '))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\\([+.\-*_()#])/g, '$1')
    .replace(/^[ \t]*>\s?/gm, '')
    .replace(/^[ \t]*(?:[-*•]\s+)?(?:\*\*|__)([^*_\n]{1,100})(?:\*\*|__):?[ \t]*$/gm, '## $1')
    .replace(/^([ \t]*)[*•·]\s+/gm, '$1- ')
    .replace(/\*+|__+/g, '')
    .replace(/\b(?:eg|ie|etc|vs|approx|min|max|yrs?|sr|jr)\./gi, m => m.slice(0, -1))
    .replace(/\be\.g\./gi, 'eg')
    .replace(/\bPh\.?D\.?/g, 'PhD')
    .replace(new RegExp(`\\b(?:${WORDS})\\s*\\(\\s*(\\d{1,2})\\s*\\)`, 'gi'), '$1')
    .replace(/(\d)\s*\?\s*(\d)/g, '$1-$2')
    .replace(/(\d(?:\.\d{1,2})?)\s*(?:years?|yrs?)\s+to\s+(\d)/gi, '$1 to $2')
    .replace(LABEL_FORM, '$2 years of $1')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/[ \t]+/g, ' ');
}

function sentences(line, base) {
  const out = [];
  const push = (from, to) => {
    for (let a = from; a < to;) {
      let cut = to - a > MAX_SEGMENT ? line.lastIndexOf(' ', a + MAX_SEGMENT) : to;
      if (cut <= a) cut = Math.min(to, a + MAX_SEGMENT);
      out.push({ text: line.slice(a, cut), start: base + a });
      a = cut;
    }
  };
  let from = 0;
  for (const m of line.matchAll(/(?<=[.!?])\s+(?=[A-Z0-9(\[])/g)) {
    push(from, m.index);
    from = m.index + m[0].length;
  }
  push(from, line.length);
  return out;
}

// 'preferred' | 'noise' | 'required' for a heading or label, null when it is not one.
function headingKind(text, hard) {
  const t = text.trim();
  if (!t || t.length > 70 || /\d|\b(?:years?|yrs?|yoe)\b/i.test(t)) return null;
  if (!hard && (/[.!?]$/.test(t) || t.split(/\s+/).length > 4)) return null;
  if (PREFERRED_HEADING.test(t)) return 'preferred';
  if (NOISE_HEADING.test(t)) return 'noise';
  return REQUIRED_HEADING.test(t) || hard ? 'required' : null;
}

function cleanSubject(text) {
  let t = String(text || '').trim();
  for (let i = 0; i < 8; i++) {
    const m = t.match(LEAD_FILLER);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  if (/^\d/.test(t)) return '';
  t = t.split(/[,;:.()[\]]/)[0];
  const stop = (' ' + t).search(SUBJECT_STOP);
  if (stop >= 0) t = t.slice(0, Math.max(0, stop - 1 + 1));
  const out = t
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ')
    .replace(/\s+(?:roles?|positions?|related)$/i, '');
  return out.length >= 2 && !/^(?:without|and|or|no)$/i.test(out) ? out : '';
}

// "X (5+ years)" and "X experience: 5+ years": the subject sits before the figure.
function subjectBefore(before) {
  const t = before.trimEnd();
  if (!/[(:]$/.test(t)) return '';
  const tail = t
    .replace(/[(:\s]+$/, '')
    .split(/[,;:.()]/)
    .pop()
    .replace(/\s*(?:experience|expertise)$/i, '');
  return cleanSubject(tail.trim().split(/\s+/).slice(-4).join(' '));
}

function snippet(sent, from, to) {
  let t = sent.slice(from, to);
  const stop = t.search(/[.;](?:\s|$)/);
  if (stop > 0) t = t.slice(0, stop);
  return t.trim().length > 100
    ? t
        .trim()
        .slice(0, 100)
        .replace(/\s+\S*$/, '')
    : t.trim();
}

// Why this figure is not about the candidate's experience, or null when it is.
function notExperience(sent, idx, end, nums, singular, section) {
  const left = sent.slice(Math.max(0, idx - 70), idx).toLowerCase();
  const right = sent.slice(end, end + 70).toLowerCase();
  const from = sent.lastIndexOf(';', idx) + 1;
  const to = sent.indexOf(';', end);
  const clause = sent.slice(from, to < 0 ? sent.length : to);
  const candidate = CANDIDATE.test(clause);
  if (nums.some(n => !(n <= MAX_YEARS))) return 'implausible';
  if (LEFT_NOT.test(left) || RIGHT_NOT.test(right)) return 'time-or-term';
  if (singular && SINGULAR_NOT.test(right)) return 'term-or-program';
  if (CLAUSE_NOT.test(clause) && !candidate) return 'benefit-pay-or-history';
  if (nums.some(n => n >= 20) && !candidate) return 'company-claim';
  if (section === 'noise' && !EXPERIENCE.test(clause)) return 'benefit-section';
  return null;
}

function collect(sent, base, section, mentions, traps) {
  const found = [];
  for (const m of sent.matchAll(YEARS_RE)) {
    const idx = m.index;
    const end = idx + m[0].length;
    const a = valueOf(m[1]);
    const b = m[3] != null ? valueOf(m[3]) : null;
    const nums = b == null ? [a] : [a, b];
    const reason = notExperience(sent, idx, end, nums, /^(?:year|yr)$/i.test(m[5]), section);
    if (reason) {
      traps.push({
        start: base + idx,
        end: base + end,
        text: snippet(sent, idx, end + 30),
        reason,
      });
      continue;
    }
    const q = QUALIFIER_RE.exec(sent.slice(Math.max(0, idx - 32), idx));
    const word = q ? q[1].toLowerCase() : '';
    const upTo = /^(?:up to|maximum|max|under|less than)/.test(word);
    const open =
      (m[4] ?? m[2]) ||
      /^(?:at least|a minimum|minimum|min|over|more than|greater|upwards)/.test(word);
    const min = b == null ? (upTo ? 0 : a) : Math.min(a, b);
    const max = m[4] || (b == null && open && !upTo) ? null : b == null ? a : Math.max(a, b);
    const start = q ? idx - (q[0].length - (/^[\s(,;:]/.test(q[0]) ? 1 : 0)) : idx;
    found.push({ min, max, idx, end, start: Math.max(0, start), unit: true });
  }
  for (let i = 0; i < found.length; i++) {
    const rest = sent.slice(found[i].end, found[i + 1]?.idx ?? sent.length);
    for (const f of rest.matchAll(FOLLOW_RE)) {
      const n = valueOf(f[1]);
      if (!(n >= 0 && n <= MAX_YEARS)) continue;
      const at = found[i].end + f.index;
      found.push({
        min: n,
        max: f[2] ? null : n,
        idx: at,
        end: at + f[0].length,
        start: at + f[0].search(/\d|[a-z]/i),
        follow: f[3],
      });
    }
  }
  found.sort((x, y) => x.idx - y.idx);
  if (!found.length) return;

  // A marker word belongs to the figure right after it, or (for noun markers) the one before it.
  const preferred = new Set();
  for (const mk of sent.matchAll(MARKER_RE)) {
    const mkEnd = mk.index + mk[0].length;
    const next = found.find(c => c.idx >= mkEnd);
    const prev = [...found].reverse().find(c => c.end <= mk.index);
    if (next && next.idx - mkEnd <= 25 && !/[,;.]/.test(sent.slice(mkEnd, next.idx)))
      preferred.add(next);
    else if (
      !ADVERB_MARKER.test(mk[0]) &&
      prev &&
      mk.index - prev.end <= 60 &&
      !/[;.]/.test(sent.slice(prev.end, mk.index))
    )
      preferred.add(prev);
  }

  // Two or more figures whose own clause names a degree (or "without a degree") read as
  // alternative paths. They are flagged, not resolved.
  const withDegree = found.filter(c => {
    const clause = sent.slice(
      sent.lastIndexOf(';', c.idx) + 1,
      (sent.indexOf(';', c.end) + 1 || sent.length + 1) - 1,
    );
    return DEGREE_RE.test(clause) || WITHOUT_RE.test(clause);
  });
  const alternatives = withDegree.length > 1;

  found.forEach((c, i) => {
    const before = sent.slice(Math.max(0, c.start - 60), c.start);
    const after = sent.slice(c.end, Math.min(c.end + 140, found[i + 1]?.start ?? Infinity));
    const subject = c.follow
      ? cleanSubject(c.follow)
      : cleanSubject(after) || subjectBefore(before);
    mentions.push({
      min: c.min,
      max: c.max,
      subject,
      kind: section === 'preferred' || preferred.has(c) ? 'preferred' : 'required',
      text: snippet(
        sent,
        c.start,
        Math.max(c.end, Math.min(c.end + 60, found[i + 1]?.start ?? Infinity)),
      ),
      start: base + c.start,
      end: base + c.end,
      total: /^[\s,(-]*(?:total|overall|in total|combined|altogether)\b/i.test(
        sent.slice(c.end, c.end + 30),
      ),
      alternatives,
    });
  });
}

// Every candidate figure, with what was done with it. Public for measurement and tests.
export function scanYears(jdText) {
  const normalized = normalizeText(jdText);
  const mentions = [];
  const traps = [];
  let section = 'required';
  let pos = 0;
  while (pos <= normalized.length) {
    let nl = normalized.indexOf('\n', pos);
    if (nl < 0) nl = normalized.length;
    const raw = normalized.slice(pos, nl);
    const lead = raw.match(/^\s*/)[0].length;
    const mark = /^(?:#{1,6}|-|\d{1,2}[.)])\s+/.exec(raw.slice(lead));
    const body = raw.slice(lead + (mark ? mark[0].length : 0));
    if (body) {
      // "Mandatory Skills: ..." labels a section on the same line.
      const label = /^([^.:]{1,40}):/.exec(body);
      const labelKind = label && headingKind(label[1], false);
      const heading = headingKind(
        body,
        Boolean(mark && mark[0][0] === '#') || /:$/.test(body.trim()),
      );
      if (labelKind) section = labelKind;
      if (heading) section = heading;
      else
        for (const s of sentences(body, pos + lead + (mark ? mark[0].length : 0)))
          collect(s.text, s.start, section, mentions, traps);
    }
    pos = nl + 1;
  }
  return { normalized, mentions, traps };
}

export function inferLevel(title) {
  const t = String(title ?? '').slice(0, 200);
  const row = LEVEL_TABLE.find(r => r.re.test(t));
  return row ? { level: row.level, min: row.min, max: row.max } : null;
}

function firstHeading(jdText) {
  const lines = normalizeText(jdText).split('\n', 400);
  const find = re => lines.map(l => re.exec(l)?.[1]?.trim()).find(Boolean);
  return (
    find(/^\s*#{1,6}\s+(.+)$/) ||
    find(/^\s*(?:job )?title:\s*(.+)$/i) ||
    find(/^\s*(\S.{0,119})$/) ||
    ''
  );
}

const whole = n => (n == null ? null : Math.floor(n));

/**
 * Estimate the years of experience a job description asks for (scans at most MAX_INPUT_CHARS).
 * headline.min and headline.max are integers or null; max null means open ended.
 */
export function estimateYoe(jdText, { title } = {}) {
  const seen = new Set();
  const mentions = scanYears(jdText).mentions.filter(m => {
    const key = `${m.min}|${m.max}|${m.subject.toLowerCase()}|${m.kind}`;
    return !seen.has(key) && seen.add(key);
  });
  const required = mentions.filter(m => m.kind === 'required');
  const pool = required.length ? required : mentions;
  const chosen = pool.reduce((best, m) => (!best || m.min > best.min ? m : best), null);
  const flags = [];
  if (pool.length > 1) flags.push('multiple');
  if (!required.length && mentions.length) flags.push('preferred-only');
  if (pool.some(m => m.alternatives)) flags.push('alternatives');
  if (required.some(m => m.total)) flags.push('total');
  if (chosen && chosen.max == null) flags.push('open');
  else if (chosen && chosen.max > chosen.min) flags.push('range');

  let headline = { min: null, max: null, source: 'none', confidence: 'low' };
  if (chosen) {
    const confidence =
      !required.length || flags.includes('alternatives')
        ? 'low'
        : pool.length > 1
          ? 'medium'
          : 'high';
    headline = {
      min: whole(chosen.min),
      max: chosen.max == null ? null : Math.ceil(chosen.max),
      source: 'stated',
      confidence,
    };
  } else {
    const level = inferLevel(title ?? firstHeading(jdText));
    if (level)
      headline = { min: level.min, max: level.max, source: 'inferred-title', confidence: 'low' };
  }
  return {
    headline,
    mentions: mentions.map(({ min, max, subject, kind, text }) => ({
      min,
      max,
      subject,
      kind,
      text,
    })),
    flags,
  };
}

const NO_ESTIMATE = Object.freeze({ yoe_min: null, yoe_confidence: null });

/**
 * Map an estimate to the two job_descriptions columns. A stated headline keeps its confidence,
 * a title-inferred one is stored as 'inferred', no estimate is null for both.
 */
export function yoeColumns(estimate) {
  const headline = estimate?.headline;
  if (!headline || !Number.isInteger(headline.min) || headline.min < 0 || headline.min > 40)
    return { ...NO_ESTIMATE };
  if (headline.source === 'inferred-title')
    return { yoe_min: headline.min, yoe_confidence: 'inferred' };
  if (headline.source === 'stated' && ['high', 'medium', 'low'].includes(headline.confidence))
    return { yoe_min: headline.min, yoe_confidence: headline.confidence };
  return { ...NO_ESTIMATE };
}

/** Columns for a stored job description. A parser failure is a null estimate, never a throw. */
export function yoeForJob(content, title) {
  try {
    return yoeColumns(estimateYoe(content, { title: title || undefined }));
  } catch {
    return { ...NO_ESTIMATE };
  }
}
