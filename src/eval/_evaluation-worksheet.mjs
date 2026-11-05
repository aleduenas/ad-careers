// The model returns exactly the JSON worksheet written into each prompt's
// .md file — nothing here builds prompt text or output shape at runtime.
// These functions only turn that JSON into the plain values render() needs.
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
// Amounts arrive as plain digits from the worksheet; format() renders a single
// display convention so the dashboard never has to parse free-form JD text.
const parseAmount = v => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
// The prompt requires annual amounts. No salaried role pays under $1,000 a year,
// so a smaller figure is an unconverted hourly rate: annualize it at 40 h x 52.
const HOURS_PER_YEAR = 2080;
const annualize = n => (n && n < 1000 ? n * HOURS_PER_YEAR : n);
const formatAmount = n => '$' + Math.round(n).toLocaleString('en-US');
export function formatCompensation(cd) {
  const low = annualize(parseAmount(cd.band_min));
  const high = annualize(parseAmount(cd.band_max));
  if (low && high) {
    const usd = String(cd.band_currency).trim().toUpperCase() === 'USD' ? ' USD' : '';
    return `${formatAmount(low)} - ${formatAmount(high)}${usd}`;
  }
  const estLow = annualize(parseAmount(cd.estimate_min));
  const estHigh = annualize(parseAmount(cd.estimate_max));
  if (estLow && estHigh) return `${formatAmount(estLow)} - ${formatAmount(estHigh)} estimated`;
  return 'UNKNOWN — JD lists no band and no market estimate available';
}
const table = (headers, rows) =>
  '| ' +
  headers.join(' | ') +
  ' |\n| ' +
  headers.map(() => '---').join(' | ') +
  ' |\n' +
  rows
    .map(row => '| ' + row.map(v => String(v).replace(/[|\r\n]/g, ' ')).join(' | ') + ' |')
    .join('\n');
export function validEvidenceDate(value) {
  if (['UNKNOWN', 'UNAVAILABLE'].includes(value)) return true;
  const raw = (value || '').replace(/^accessed\s+/i, '');
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  if (year < 1900 || year > 2100 || (month !== undefined && (month < 1 || month > 12)))
    return false;
  return day === undefined || (day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate());
}
// The model returns raw JSON as-is for the gate worksheet; no transform needed.
export const passthrough = { decode: v => v };
export function researchDecode(sections) {
  return (raw, strict = false) => {
    const result = { sections: {}, reason: raw.limitations || 'Incomplete response' };
    const errors = [];
    for (const section of sections) {
      const items = Array.isArray(raw.sections?.[section]?.evidence)
        ? raw.sections[section].evidence
        : [];
      const facts = [];
      for (const e of items) {
        if (e && nonempty(e.fact) && e.fact !== 'NONE') {
          if (validEvidenceDate(e.date) && /^https?:\/\/\S+$/.test(e.url || ''))
            facts.push(`${e.fact} (Source date/access: ${e.date}; ${e.url})`);
          else errors.push(`${section}: evidence needs a valid date and url`);
        }
      }
      result.sections[section] = facts.length ? facts.join('\n\n') : null;
    }
    if (strict && errors.length) throw new Error(errors.join('; '));
    return result;
  };
}
export function evaluationDecode(dimensions, research = {}) {
  return raw => {
    const scores = dimensions.map(dimension => {
      const s = raw.scores?.[dimension];
      if (!s || !Number.isFinite(Number(s.score)) || !nonempty(s.evidence))
        throw new Error('Invalid score for ' + dimension);
      return { dimension, score: Number(s.score), evidence: s.evidence };
    });
    const rs = raw.role_summary || {};
    const blockA = table(
      ['Finding', 'Details'],
      [
        ['archetype', rs.archetype],
        ['domain', rs.domain],
        ['function', rs.function],
        ['seniority', rs.seniority],
        ['location', rs.location],
        ['team', rs.team],
        ['summary', rs.summary],
      ],
    );
    const rows = Array.isArray(raw.requirements) ? raw.requirements : [];
    // Prompts retain their concise targets. Validation permits a small overage so
    // an otherwise sound worksheet does not require a repair for one extra item.
    if (rows.length < 1 || rows.length > 12)
      throw new Error('requirements needs 1-12 rows (target 1-10)');
    if (rows.some(r => !nonempty(r?.requirement) || !nonempty(r?.evidence) || !nonempty(r?.match)))
      throw new Error('Each requirement row needs requirement, evidence and match');
    const rowsText = rows.map(r => [r.requirement, r.evidence, r.match, r.mitigation || 'NONE']);
    if (rowsText.flat().join(' ').split(/\s+/).length > 500)
      throw new Error(
        'requirements exceeds 500 words; shorten evidence, group related requirements. Target 250-350 words.',
      );
    const blockB = table(['JD Requirement', 'CV Evidence', 'Match / Gap', 'Mitigation'], rowsText);
    const ls = raw.level_and_strategy || {};
    const blockC = table(
      ['Finding', 'Details'],
      [
        ['level', ls.level],
        ['positioning', ls.positioning],
        ['downlevel', ls.downlevel],
        ['floor', ls.floor],
      ],
    );
    const cd = raw.comp_and_demand || {};
    const advertisedLow = parseAmount(cd.band_min);
    const advertisedHigh = parseAmount(cd.band_max);
    const estimatedLow = parseAmount(cd.estimate_min);
    const estimatedHigh = parseAmount(cd.estimate_max);
    const bandUnknown = String(cd.band || '')
      .trim()
      .toUpperCase()
      .startsWith('UNKNOWN');
    if (bandUnknown && (!estimatedLow || !estimatedHigh))
      throw new Error(
        'comp_and_demand requires numeric estimate_min and estimate_max when the JD band is UNKNOWN',
      );
    if (!bandUnknown && (!advertisedLow || !advertisedHigh))
      throw new Error(
        'comp_and_demand requires numeric band_min and band_max for an advertised band',
      );
    const blockD = table(
      ['Finding', 'Details'],
      [
        ['band', cd.band],
        ['market research', research.market || 'UNAVAILABLE'],
        ['employer research', research.employer || 'UNAVAILABLE'],
      ],
    );
    const cp = raw.customization_plan || {};
    const cvChanges = Array.isArray(cp.cv_changes) ? cp.cv_changes : [];
    if (cvChanges.length < 5 || cvChanges.length > 6)
      throw new Error('customization_plan needs 5-6 cv_changes (target exactly five)');
    const blockE = table(
      ['Priority', 'CV change'],
      cvChanges.map((change, i) => [i + 1, change]),
    );
    const pl = raw.posting_legitimacy || {};
    const blockF = table(
      ['Finding', 'Details'],
      [
        ['quality', pl.quality],
        ['hiring signals', research.hiring || 'UNAVAILABLE'],
        ['stale', pl.stale],
        ['assessment', pl.assessment],
      ],
    );
    if (
      !Array.isArray(raw.keywords) ||
      raw.keywords.length < 15 ||
      raw.keywords.length > 22 ||
      raw.keywords.some(k => !nonempty(k))
    )
      throw new Error('keywords needs 15-22 entries (target 15-20)');
    return {
      legitimacy: raw.legitimacy,
      note: raw.verdict,
      compensationBand: formatCompensation(cd),
      scores,
      blocks: { A: blockA, B: blockB, C: blockC, D: blockD, E: blockE, F: blockF },
      keywords: raw.keywords,
    };
  };
}
