import { existsSync, readFileSync } from 'node:fs';

export const RESEARCH_SECTIONS = ['Company Reputation & Culture', 'Layoffs & Hiring Signals'];

export function companyFreshness(path, now = new Date()) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return Object.fromEntries(
    RESEARCH_SECTIONS.map(heading => {
      const block = text.match(
        new RegExp(`^## ${heading}\\s*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'),
      )?.[1];
      const ownDate = block?.match(/\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1];
      const legacyDate =
        heading === RESEARCH_SECTIONS[1]
          ? text.split(/^## /m)[0].match(/\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1]
          : null;
      const age = (now - new Date(ownDate || legacyDate)) / 86400000;
      const evidence = block?.replace(/\*\*Last updated:\*\*\s*\d{4}-\d{2}-\d{2}/g, '').trim();
      return [heading, Boolean(evidence) && age >= 0 && age < 90];
    }),
  );
}
