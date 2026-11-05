import { query, root } from './_database.mjs';
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function lease(resource, owner) {
  const acquire = async () => {
    const [r] = await query('SELECT claim_work($1,$2,300) AS acquired', [resource, owner]);
    if (!r.acquired) throw new Error('Work already claimed: ' + resource);
  };
  await acquire();
  let lost = null;
  const timer = setInterval(
    () =>
      acquire().catch(e => {
        lost = e;
      }),
    60000,
  );
  timer.unref();
  const release = async () => {
    clearInterval(timer);
    await query('DELETE FROM workflow_claims WHERE resource=$1 AND owner_token=$2', [
      resource,
      owner,
    ]);
  };
  release.assert = async () => {
    if (lost) throw lost;
    const rows = await query(
      'SELECT 1 FROM workflow_claims WHERE resource=$1 AND owner_token=$2 AND expires_at>now()',
      [resource, owner],
    );
    if (!rows.length) throw new Error('Lease lost: ' + resource);
  };
  return release;
}
export async function publishEvaluation(job, result, report, owner, operation = owner) {
  const target = resolve(root, job.report_path),
    rel = relative(join(root, 'data', 'evaluations'), target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Report path must be within data/evaluations');
  // Immutable publication prevents a retry from replacing a different report.
  const path = target.replace(/\.md$/, '-' + operation + '.md');
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== report)
      throw new Error('Published report differs from retry');
  } else {
    mkdirSync(dirname(path), { recursive: true });
    const temp = path + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, report);
    renameSync(temp, path);
  }
  await query('SELECT * FROM complete_evaluation($1,$2,$3,$4,$5,$6,$7)', [
    job.num,
    owner,
    operation + ':' + job.num,
    result.score,
    relative(root, path).replaceAll('\\', '/'),
    result.status,
    result.note || '',
  ]);
}
