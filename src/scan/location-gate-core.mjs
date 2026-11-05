/**
 * location-gate-core.mjs — shared location gate logic used by scan.mjs.
 *
 * gate(url, company, role, jdContent?) → { decision: "PASS"|"FAIL"|"UNKNOWN", reason, confidence }
 *
 * Eligible locations: Toronto-area (on-site/hybrid) OR explicitly remote-from-Canada.
 * A Canada signal alone does not pass — must be accompanied by Toronto-area OR "remote".
 * When in doubt, PASS with low confidence — the evaluator is the final safety net.
 */

export const TORONTO_AREA_PATTERNS = [
  /toronto/i,
  /vaughan/i,
  /mississauga/i,
  /markham/i,
  /brampton/i,
  /oakville/i,
  /richmond\s*hill/i,
  /greater\s*toronto/i,
];

export const CANADA_PATTERNS = [
  /canada/i,
  /toronto/i,
  /ontario/i,
  /british\s*columbia/i,
  /\bbc\b/,
  /\bON\b/,
  /alberta/i,
  /vancouver/i,
  /montr[eé]al/i,
  /ottawa/i,
  /winnipeg/i,
  /calgary/i,
  /edmonton/i,
  /vaughan/i,
  /mississauga/i,
  /\bCAN\b/,
  /\-ON\-/,
  /\-CAN/,
];

// Weak signal — "remote" appears somewhere; may still be US-only or hybrid
export const REMOTE_PATTERNS = [/\bremote\b/i];

// Strong signal — explicitly full/100% remote, remote-first, or globally open
export const STRONG_REMOTE_PATTERNS = [
  /\bfully\s+remote\b/i,
  /\b100%\s*remote\b/i,
  /\bremote[\s-]first\b/i,
  /\bremote[\s-]only\b/i,
  /\bwork\s+from\s+(home|anywhere)\b/i,
  /\bworldwide\b/i,
  /\banywhere\b/i,
];

export const US_LOCATION_PATTERNS = [
  /united states/i,
  /\bUS\b/,
  /\bUSA\b/,
  /\bU\.S\.\b/,
  /\bU\.S\.A\./i,
  /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i,
  /,\s*(CA|NY|TX|WA|MA|IL|CO|GA|FL|AZ|PA|OR|MN|NC|VA|NV|OH|MI|MD|DC)\b/,
];

export const HARD_REJECT_PHRASES = [
  /must be (authorized|eligible|permitted) to work in the (United States|US|U\.S\.)/i,
  /authorized to work in the (United States|US)/i,
  /US citizens? (only|and permanent residents)/i,
  /must (live|reside|be located|be based) in the (United States|US)/i,
  /only (open|available|accepting) (to|for) (US|United States)/i,
  /not (available|open|eligible) (to|for) (Canada|Canadian)/i,
];

function matchesAny(text, patterns) {
  return patterns.some(p => p.test(text));
}

/** Parse YAML-style frontmatter key: value lines. */
export function parseFrontmatter(content) {
  const fm = {};
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return fm;
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  return fm;
}

/**
 * Gate a single job. jdContent is optional — if omitted, only URL/metadata signals are used.
 * Returns { decision: "PASS"|"FAIL", reason, confidence: "high"|"low" }
 */
export function gate(url, company, role, jdContent = null, jobLocation = '') {
  const urlAndMeta = `${url} ${company} ${role}`;

  // Explicit work-authorization/location restrictions in the full JD win
  // over generic "remote" wording in the URL or metadata.
  if (jdContent) {
    for (const p of HARD_REJECT_PHRASES) {
      if (p.test(jdContent))
        return {
          decision: 'FAIL',
          reason: `Hard reject phrase: "${jdContent.match(p)?.[0]}"`,
          confidence: 'high',
        };
    }
  }

  const suppliedRawLocation =
    jobLocation || (jdContent ? parseFrontmatter(jdContent).location : '') || '';
  const suppliedLocation = /^(?:n\/?a|unknown|multiple locations?)$/i.test(
    suppliedRawLocation.trim(),
  )
    ? ''
    : suppliedRawLocation;

  // Provider location data is stronger than a generic "remote" word in a
  // title or URL. In particular, "US - Remote" must not fast-pass.
  if (suppliedLocation) {
    if (matchesAny(suppliedLocation, TORONTO_AREA_PATTERNS))
      return {
        decision: 'PASS',
        reason: `Toronto-area in job location: ${suppliedLocation}`,
        confidence: 'high',
      };

    const locationRemote = matchesAny(suppliedLocation, REMOTE_PATTERNS);
    const locationCanada = matchesAny(suppliedLocation, CANADA_PATTERNS);
    const locationUS = matchesAny(suppliedLocation, US_LOCATION_PATTERNS);
    if (locationRemote && locationCanada)
      return {
        decision: 'PASS',
        reason: `Remote from Canada in job location: ${suppliedLocation}`,
        confidence: 'high',
      };
    if (locationRemote && locationUS)
      return {
        decision: 'FAIL',
        reason: `US-only remote location: "${suppliedLocation}"`,
        confidence: 'high',
      };
    if (locationRemote)
      return {
        decision: 'PASS',
        reason: `Remote location without an explicit country restriction: ${suppliedLocation}`,
        confidence: 'low',
      };
    if (locationCanada)
      return {
        decision: 'FAIL',
        reason: `Canadian location outside Toronto area with no remote signal: "${suppliedLocation}"`,
        confidence: 'high',
      };
    if (locationUS)
      return { decision: 'FAIL', reason: `US location: "${suppliedLocation}"`, confidence: 'high' };
    return {
      decision: 'FAIL',
      reason: `Explicit location outside the Toronto area with no remote signal: "${suppliedLocation}"`,
      confidence: 'high',
    };
  }

  if (matchesAny(urlAndMeta, REMOTE_PATTERNS)) {
    const metadataCanada = matchesAny(urlAndMeta, CANADA_PATTERNS);
    const metadataUS = matchesAny(urlAndMeta, US_LOCATION_PATTERNS);
    if (metadataUS && !metadataCanada)
      return {
        decision: 'FAIL',
        reason: 'US-only remote signal in URL/metadata',
        confidence: 'high',
      };
  }

  // Fast PASS: unambiguous Toronto-area or remote signal in URL/metadata
  if (matchesAny(urlAndMeta, REMOTE_PATTERNS))
    return { decision: 'PASS', reason: 'Remote signal in URL/metadata', confidence: 'high' };
  if (matchesAny(urlAndMeta, TORONTO_AREA_PATTERNS))
    return { decision: 'PASS', reason: 'Toronto-area signal in URL/metadata', confidence: 'high' };

  if (!jdContent) {
    return {
      decision: 'PASS',
      reason: 'No cached JD — evaluator will verify location',
      confidence: 'low',
    };
  }

  const fm = parseFrontmatter(jdContent);
  const location = fm.location || '';
  const type = (fm.type || '').toLowerCase();
  const fullText = jdContent;

  // Explicit remote type in frontmatter → PASS
  if (/remote/i.test(type))
    return { decision: 'PASS', reason: `JD type: ${fm.type}`, confidence: 'high' };

  // Toronto-area in location → PASS (hybrid here is eligible)
  if (matchesAny(location, TORONTO_AREA_PATTERNS))
    return {
      decision: 'PASS',
      reason: `Toronto-area in JD location: ${location}`,
      confidence: 'high',
    };

  // Remote in location — only PASS if there is no US country signal alongside it.
  // "Remote, United States" → fall through to the US-location block below.
  if (matchesAny(location, REMOTE_PATTERNS) && !matchesAny(location, US_LOCATION_PATTERNS))
    return {
      decision: 'PASS',
      reason: `Remote signal in JD location: ${location}`,
      confidence: 'high',
    };

  // Canada in location but not Toronto-area and not remote → not eligible
  if (matchesAny(location, CANADA_PATTERNS))
    return {
      decision: 'FAIL',
      reason: `Canadian location outside Toronto area with no remote signal: "${location}"`,
      confidence: 'high',
    };

  // US location in frontmatter — require explicit Canada/worldwide remote evidence in the body
  if (matchesAny(location, US_LOCATION_PATTERNS)) {
    const hasStrongRemote = matchesAny(fullText, STRONG_REMOTE_PATTERNS);
    const hasCanadaScope = /canada|north\s+america|worldwide|anywhere/i.test(fullText);
    if (hasStrongRemote && hasCanadaScope)
      return {
        decision: 'PASS',
        reason: 'US location but full-remote + Canada/worldwide scope confirmed in JD',
        confidence: 'low',
      };
    return {
      decision: 'FAIL',
      reason: `US location "${location}" — no Canada-eligible remote evidence found`,
      confidence: 'high',
    };
  }

  // Strong full-remote signal in body (fully remote / 100% remote / remote-first / worldwide)
  // Only reached when location field is absent or ambiguous (not US, not Canada, not Toronto)
  if (matchesAny(fullText, STRONG_REMOTE_PATTERNS))
    return { decision: 'PASS', reason: 'Strong full-remote signal in JD body', confidence: 'high' };

  // Toronto-area mentioned in JD body → PASS
  if (matchesAny(fullText, TORONTO_AREA_PATTERNS))
    return { decision: 'PASS', reason: 'Toronto-area mentioned in JD body', confidence: 'high' };

  // Weak remote in body with no hybrid qualifier — pass low-confidence for evaluator to verify
  if (matchesAny(fullText, REMOTE_PATTERNS) && !/hybrid/i.test(fullText))
    return {
      decision: 'PASS',
      reason: 'Remote mentioned in JD body (non-hybrid) — evaluator to verify Canada eligibility',
      confidence: 'low',
    };

  return { decision: 'PASS', reason: 'No disqualifying signals found', confidence: 'low' };
}
