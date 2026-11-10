import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

function inside(parent, candidate) {
  const rel = relative(parent, candidate);
  return (
    rel === '' ||
    (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      rel !== '..' &&
      !isAbsolute(rel))
  );
}

export async function inspectSafeFile(rootDir, relativePath, allowedRoots) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) return null;
  const root = await realpath(rootDir).catch(() => null);
  if (!root) return null;
  const candidate = resolve(root, relativePath);
  if (!inside(root, candidate)) return null;
  for (const allowedRelative of allowedRoots) {
    const allowedLexical = resolve(root, allowedRelative);
    const allowed = await realpath(allowedLexical).catch(() => null);
    if (!allowed) {
      if (inside(root, allowedLexical) && inside(allowedLexical, candidate))
        return { status: 'missing' };
      continue;
    }
    if (!inside(root, allowed) || allowed !== allowedLexical) continue;
    if (!inside(allowed, candidate)) continue;
    const relativeCandidate = relative(allowed, candidate);
    let walked = allowed;
    const components = relativeCandidate.split(/[\\/]/).filter(Boolean);
    for (let index = 0; index < components.length; index++) {
      walked = resolve(walked, components[index]);
      const info = await lstat(walked).catch(error => error);
      if (info?.code === 'ENOENT' || info?.code === 'ENOTDIR') return { status: 'missing' };
      if (!info || info.isSymbolicLink()) return { status: 'unsafe' };
      if (index < components.length - 1 && !info.isDirectory()) return { status: 'missing' };
      if (index === components.length - 1 && !info.isFile()) return { status: 'unsafe' };
    }
    const actual = await realpath(candidate).catch(() => null);
    if (!actual || !inside(allowed, actual)) return { status: 'unsafe' };
    return { status: 'ok', path: actual, allowedRoot: allowed };
  }
  return { status: 'unsafe' };
}

export async function resolveSafeFile(rootDir, relativePath, allowedRoots) {
  const result = await inspectSafeFile(rootDir, relativePath, allowedRoots);
  return result?.status === 'ok' ? result : null;
}

export async function resolveSafeDirectory(rootDir, candidate, allowedRoot) {
  const root = await realpath(rootDir).catch(() => null);
  if (!root || !inside(root, candidate)) return null;
  const allowed = await realpath(allowedRoot).catch(() => null);
  if (!allowed || allowed !== allowedRoot || !inside(root, allowed)) return null;
  const actual = await realpath(candidate).catch(() => null);
  if (!actual || !inside(allowed, actual)) return null;
  const info = await lstat(candidate).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) return null;
  return actual;
}

export function isContainedPath(parent, child) {
  return inside(parent, child);
}
