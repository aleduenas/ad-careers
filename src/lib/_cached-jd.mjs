import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
function urlKey(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.searchParams.sort();
    return url.href;
  } catch {
    return value;
  }
}
// Company display names and scan-time cache folder names can differ. Fall back
// to exact posting URL identity, never a fuzzy title or employer-name guess.
export function findCachedJD(root, job) {
  const base = join(root, 'data', 'jds'),
    dir = join(base, slug(job.company));
  if (!existsSync(base)) return null;
  const exact = join(dir, slug(job.role) + '.md');
  if (existsSync(exact)) return exact;
  if (!job.url) return null;
  const target = urlKey(job.url),
    matches = [];
  for (const company of readdirSync(base, { withFileTypes: true })) {
    if (!company.isDirectory()) continue;
    const folder = join(base, company.name);
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const path = join(folder, file.name);
      const urls = readFileSync(path, 'utf8').match(/https?:\/\/[^\s<>"'`]+/g) || [];
      if (urls.some(u => urlKey(u.replace(/[),.;]+$/, '')) === target)) matches.push(path);
    }
  }
  if (matches.length > 1)
    throw new Error(
      'Ambiguous cached JD for #' + (job.num || job.id || '?') + ': ' + matches.join(', '),
    );
  return matches[0] || null;
}
