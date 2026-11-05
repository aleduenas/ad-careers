// CV/letter drafting helpers specific to cvgen. The shared CLI runtime lives in
// src/lib/cli-runtime.mjs.
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { getJob } from '../lib/_database.mjs';
import { getJD } from '../lib/_job-descriptions.mjs';
import { slug } from './_cv-content.mjs';

// Candidate identity comes from config/profile.yml, never from code.
export function candidateName(root) {
  const profile = yaml.load(readFileSync(join(root, 'config/profile.yml'), 'utf8'));
  const name = String(profile?.candidate?.full_name || '').trim();
  if (!name) throw new Error('config/profile.yml must define candidate.full_name');
  return name;
}
export const candidateFileStem = root => 'cv-' + slug(candidateName(root));
export function jobOutputPath(root, job) {
  if (!/^\d+$/.test(String(job.id)) || BigInt(job.id) <= 0n)
    throw new Error('Job must have a permanent positive ID');
  return join(root, 'output', slug(job.company), slug(job.role) + '--' + BigInt(job.id));
}
export const wrapCoverLetter = (body, name) =>
  `Dear hiring team,\n\n${body.trim()}\n\nThank you,\n${name}\n`;
export function customizationContext(report) {
  const heading = /^## E[).] Customization Plan[ \t]*\r?$/m.exec(report);
  if (!heading) return 'No evaluation CV-customization guidance is available.';
  const body = report.slice(heading.index + heading[0].length),
    next = body.search(/^## [A-Z][).] /m);
  return (
    body.slice(0, next < 0 ? undefined : next).trim() ||
    'No evaluation CV-customization guidance is available.'
  );
}

export async function resolveJob(root, id) {
  if (!/^\d+$/.test(id)) throw new Error('Job must be a permanent numeric ID');
  const job = await getJob(id);
  if (!job.report_path) throw new Error('No evaluation report for #' + id);
  const report = join(root, job.report_path);
  if (!existsSync(report)) throw new Error('Evaluation report missing: ' + report);
  const jd = await getJD(id);
  if (!jd)
    throw new Error(
      'Database JD missing. Run node src/helpers/sync-jds.mjs --apply after checking the cached file.',
    );
  return {
    jd: join(root, jd.file_path),
    jdContent: jd.content,
    report,
    out: jobOutputPath(root, job),
  };
}

// A draft that is killed mid-run (closing the dashboard, a machine restart)
// cannot clean up after itself, so a lock records its owner and the lock is
// reclaimed once that owner is gone. Without this a single interrupted run
// blocks every later draft for the same role permanently.
const LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function lockPath(archive, out, artifact) {
  return join(
    archive,
    'locks',
    out
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
      '.' +
      artifact +
      '.lock',
  );
}

function readLock(lock) {
  try {
    const parsed = JSON.parse(readFileSync(lock, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.runId) return parsed;
  } catch {
    // Unreadable or pre-owner-tracking lock file.
  }
  return null;
}

function ownerAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error.code === 'EPERM';
  }
}

// describeLock reports whether an existing lock still has a live owner, plus a
// human-readable holder for the error message.
function describeLock(lock) {
  const owner = readLock(lock);
  if (!owner) return { stale: true, holder: 'an interrupted run (no owner recorded)' };
  const age = Date.now() - Date.parse(owner.startedAt || '');
  const expired = !Number.isFinite(age) || age > LOCK_MAX_AGE_MS;
  return {
    stale: expired || !ownerAlive(owner.pid),
    holder: `run ${owner.runId}, pid ${owner.pid}, started ${owner.startedAt}`,
  };
}

function claim(lock, runId) {
  try {
    writeFileSync(
      lock,
      JSON.stringify({ runId, pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: 'wx' },
    );
    return true;
  } catch {
    return false;
  }
}

// One draft of each artifact ('cv' or 'letter') per output folder at a time. The
// CV and the letter write different files, so they lock separately and can run
// side by side, as the dashboard's CV + cover letter action does.
export async function withOutputLock(archive, out, artifact, runId, action) {
  mkdirSync(join(archive, 'locks'), { recursive: true });
  const lock = lockPath(archive, out, artifact);
  if (!claim(lock, runId)) {
    const { stale, holder } = describeLock(lock);
    if (!stale)
      throw new Error(
        `Another ${artifact} draft owns this output folder (${holder}). Wait for it to finish, or remove ${lock} if you are certain it is dead.`,
      );
    try {
      unlinkSync(lock);
    } catch {
      // A concurrent run may have cleared it first; the retry below decides.
    }
    if (!claim(lock, runId))
      throw new Error(
        `Another ${artifact} draft owns this output folder. Inspect logs/drafting/locks before retrying.`,
      );
    console.log('Reclaimed a stale output lock from ' + holder + '.');
  }
  try {
    return await action();
  } finally {
    if (existsSync(lock) && readLock(lock)?.runId === runId) unlinkSync(lock);
  }
}
