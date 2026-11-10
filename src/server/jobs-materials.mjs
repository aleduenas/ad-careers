import { opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveSafeDirectory } from './jobs-paths.mjs';

const ID_SUFFIX = /--([0-9]+)$/;
const MAX_COMPANY_DIRS = 500;
const MAX_ROLE_DIRS = 3000;
const MAX_FILES_PER_ROLE = 256;

async function boundedEntries(directory, limit) {
  let handle;
  try {
    handle = await opendir(directory);
    const entries = [];
    for await (const entry of handle) {
      if (entries.length === limit) return null;
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeCompany(value) {
  let name = String(value || '')
    .trim()
    .toLowerCase();
  for (const suffix of [
    ' inc.',
    ' inc',
    ' llc',
    ' ltd',
    ' corp',
    ' corporation',
    ' technologies',
    ' technology',
    ' group',
    ' co.',
  ]) {
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
  }
  return name.trim();
}

function titleSimilarity(a, b) {
  const ignored = new Set(['canada', 'canadian', 'full', 'hybrid', 'remote', 'time']);
  const tokens = value =>
    new Set(
      slug(value)
        .split('-')
        .filter(token => token && !ignored.has(token)),
    );
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / (left.size + right.size - overlap);
}

function inspectArtifacts(names) {
  const lower = names.map(name => [name, name.toLowerCase()]);
  return {
    cv: lower.some(
      ([, name]) => name.startsWith('cv-') && ['.pdf', '.html'].some(ext => name.endsWith(ext)),
    ),
    letter: lower.some(
      ([, name]) =>
        [
          'cover-letter.md',
          'cover-letter.pdf',
          'cover-letter.html',
          'cover-letter-draft.md',
        ].includes(name) ||
        (name.startsWith('cover-letter-brief') && name.endsWith('.md')),
    ),
  };
}

async function enumerateOutput(rootDir) {
  const base = resolve(rootDir, 'output');
  const safeBase = await resolveSafeDirectory(rootDir, base, base);
  if (!safeBase) return [];
  const entries = [];
  const companies = await boundedEntries(safeBase, MAX_COMPANY_DIRS);
  if (!companies) return [];
  let roleCount = 0;
  for (const companyEntry of companies) {
    if (!companyEntry.isDirectory() || companyEntry.isSymbolicLink()) continue;
    const companyPath = join(safeBase, companyEntry.name);
    const safeCompany = await resolveSafeDirectory(rootDir, companyPath, safeBase);
    if (!safeCompany) continue;
    const roles = await boundedEntries(safeCompany, MAX_ROLE_DIRS - roleCount);
    if (!roles) return [];
    roleCount += roles.length;
    if (roleCount > MAX_ROLE_DIRS) return [];
    for (const roleEntry of roles) {
      if (!roleEntry.isDirectory() || roleEntry.isSymbolicLink()) continue;
      const rolePath = join(safeCompany, roleEntry.name);
      const safeRole = await resolveSafeDirectory(rootDir, rolePath, safeBase);
      if (!safeRole) continue;
      const files = await boundedEntries(safeRole, MAX_FILES_PER_ROLE);
      if (!files) return [];
      const names = files
        .filter(file => file.isFile() && !file.isSymbolicLink())
        .map(file => file.name);
      const flags = inspectArtifacts(names);
      if (flags.cv || flags.letter)
        entries.push({ company: companyEntry.name, role: roleEntry.name, flags });
    }
  }
  return entries;
}

function legacyMatch(entries, company, role) {
  const companySlug = slug(normalizeCompany(company));
  const roleSlug = slug(role);
  if (!companySlug || !roleSlug) return null;
  const candidates = [...new Set(entries.map(entry => entry.company))].sort();
  let bestCompany = '';
  let bestCompanyScore = 0;
  const noHyphens = companySlug.replaceAll('-', '');
  for (const candidate of candidates) {
    const candidateSlug = slug(candidate).replaceAll('-', '');
    if (candidateSlug === noHyphens) {
      bestCompany = candidate;
      bestCompanyScore = candidateSlug.length + 1000;
      break;
    }
    if (
      candidateSlug &&
      (noHyphens.includes(candidateSlug) || candidateSlug.includes(noHyphens)) &&
      candidateSlug.length > bestCompanyScore
    ) {
      bestCompany = candidate;
      bestCompanyScore = candidateSlug.length;
    }
  }
  if (!bestCompany || !bestCompanyScore) return null;
  const exact = entries.find(
    entry =>
      entry.company === bestCompany && slug(entry.role) === roleSlug && !ID_SUFFIX.test(entry.role),
  );
  if (exact) return exact.flags;
  let best = null;
  let score = 0;
  let tied = false;
  for (const entry of entries) {
    if (entry.company !== bestCompany || ID_SUFFIX.test(entry.role)) continue;
    const current = titleSimilarity(roleSlug, entry.role);
    if (current > score) {
      best = entry;
      score = current;
      tied = false;
    } else if (current === score && current > 0) tied = true;
  }
  return best && score >= 0.75 && !tied ? best.flags : null;
}

export async function resolveJobMaterials(rows, rootDir) {
  const entries = await enumerateOutput(rootDir);
  const result = new Map();
  for (const row of rows) {
    const id = String(row.id);
    const suffix = `--${id}`;
    const idMatches = entries.filter(
      entry => ID_SUFFIX.test(entry.role) && entry.role.endsWith(suffix),
    );
    if (idMatches.length === 1) {
      result.set(id, idMatches[0].flags);
      continue;
    }
    if (idMatches.length > 1) {
      result.set(id, { cv: false, letter: false });
      continue;
    }
    const legacyEntries = entries.filter(entry => !ID_SUFFIX.test(entry.role));
    result.set(
      id,
      legacyMatch(legacyEntries, row.company, row.role) || { cv: false, letter: false },
    );
  }
  return result;
}
