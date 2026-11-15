import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { root, query } from './_database.mjs';
import { yoeForJob } from './yoe.mjs';

export function readJDFile(path, base = root) {
  const folder = realpathSync(resolve(base, 'data', 'jds')),
    full = realpathSync(resolve(base, path));
  const rel = relative(folder, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('JD path must remain inside data/jds/');
  const content = readFileSync(full, 'utf8');
  if (!content.trim()) throw new Error('JD file is empty: ' + path);
  return {
    content,
    file_path: relative(base, full).replaceAll('\\', '/'),
    content_hash: createHash('sha256').update(content).digest('hex'),
  };
}
export async function syncJD(id, path) {
  const [job] = await query('SELECT id, role FROM jobs WHERE id=$1', [id]);
  if (!job) throw new Error('Unknown job ' + id);
  let j = readJDFile(path);
  const tagged = withJobID(j.content, id);
  if (tagged !== j.content) {
    writeFileSync(realpathSync(resolve(root, path)), tagged, 'utf8');
    j = readJDFile(path);
  }
  const row = (
    await query('SELECT * FROM sync_job_description($1,$2,$3,$4)', [
      id,
      j.content,
      j.file_path,
      j.content_hash,
    ])
  )[0];
  await recordYoe(id, j.content, job.role);
  return row;
}
// D116: store the years-of-experience estimate beside the description. Never fails the caller:
// a parser or database error leaves the columns as they were.
export async function recordYoe(id, content, title, run = query) {
  const columns = yoeForJob(content, title);
  try {
    await run('UPDATE job_descriptions SET yoe_min=$2, yoe_confidence=$3 WHERE job_id=$1', [
      id,
      columns.yoe_min,
      columns.yoe_confidence,
    ]);
    return columns;
  } catch {
    return null;
  }
}
export function jdJobID(content) {
  return content.match(/<!-- career-ops-job-id: (\d+) -->/)?.[1] || null;
}
export function withJobID(content, id) {
  if (!/^\d+$/.test(String(id))) throw new Error('Invalid job ID');
  const existing = jdJobID(content);
  if (existing && existing !== String(id))
    throw new Error('JD belongs to #' + existing + ', not #' + id);
  if (existing) return content;
  return content.trimEnd() + '\n\n<!-- career-ops-job-id: ' + id + ' -->\n';
}
export async function getJD(id) {
  return (await query('SELECT * FROM job_descriptions WHERE job_id=$1', [id]))[0] || null;
}
