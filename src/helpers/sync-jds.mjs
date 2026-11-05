import { query, close } from '../lib/_database.mjs';
import { readJDFile, syncJD } from '../lib/_job-descriptions.mjs';
import { jdJobID } from '../lib/_job-descriptions.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/_database.mjs';
const apply = process.argv.includes('--apply');
const jobID = process.argv.find(a => a.startsWith('--job='))?.slice(6);
const file = process.argv.find(a => a.startsWith('--file='))?.slice(7);
if (jobID && !/^\d+$/.test(jobID)) throw new Error('Invalid job ID');
if (file && !jobID) throw new Error('--file requires --job=ID');
function renamedFile(id) {
  const matches = [];
  for (const entry of readdirSync(join(root, 'data', 'jds'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(entry.parentPath, entry.name);
    if (jdJobID(readFileSync(path, 'utf8')) === String(id)) matches.push(path);
  }
  if (matches.length > 1) throw new Error('Multiple JD files claim job #' + id);
  return matches[0];
}
let synced = 0,
  missing = 0;
const errors = [];
try {
  for (const job of await query(
    'SELECT id,jd_path FROM jobs WHERE ($1::bigint IS NULL OR id=$1) ORDER BY id',
    [jobID || null],
  )) {
    if (!job.jd_path && !file) {
      missing++;
      continue;
    }
    try {
      const path =
        file || (existsSync(join(root, job.jd_path)) ? job.jd_path : renamedFile(job.id));
      if (!path) throw new Error('Linked JD missing; no file tagged with this job ID');
      if (apply) await syncJD(job.id, path);
      else readJDFile(path);
      synced++;
    } catch (e) {
      errors.push({ id: job.id, error: e.message });
    }
  }
  console.log(
    JSON.stringify(
      { mode: apply ? 'sync' : 'audit', readable: synced, without_link: missing, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await close();
}
