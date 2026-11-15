import { pathToFileURL } from 'node:url';
import { query, transaction, close } from '../lib/_database.mjs';
import { yoeForJob } from '../lib/yoe.mjs';

const SAMPLE_SIZE = 20;
const CONFIDENCES = ['high', 'medium', 'low', 'inferred'];

/**
 * Compute the years-of-experience estimate for stored job descriptions and, with apply, write it.
 * Default scope is descriptions with no stored estimate; all recomputes every row. Dry run unless
 * apply is true. Adapters are injectable so the logic is testable without a database.
 */
export async function backfillYoe({
  apply = false,
  all = false,
  jobId = null,
  run = query,
  inTransaction = transaction,
} = {}) {
  const rows = await run(
    `SELECT description.job_id::text AS id, description.content, job.role,
            description.yoe_min, description.yoe_confidence
     FROM job_descriptions AS description JOIN jobs AS job ON job.id = description.job_id
     WHERE ($1::bigint IS NULL OR description.job_id = $1::bigint)
       AND ($2::boolean OR description.yoe_confidence IS NULL)
     ORDER BY description.job_id`,
    [jobId, all],
  );
  const counts = Object.fromEntries([...CONFIDENCES, 'none'].map(key => [key, 0]));
  const results = rows.map(row => {
    const next = yoeForJob(row.content, row.role);
    counts[next.yoe_confidence ?? 'none']++;
    const changed =
      (row.yoe_min ?? null) !== next.yoe_min ||
      (row.yoe_confidence ?? null) !== next.yoe_confidence;
    return { id: row.id, role: row.role, ...next, changed };
  });
  const changes = results.filter(result => result.changed);
  // Evenly spaced across the whole range, so the sample is not just the oldest rows.
  const step = Math.max(1, Math.floor(results.length / SAMPLE_SIZE));
  const sample = results
    .filter((_, index) => index % step === 0)
    .slice(0, SAMPLE_SIZE)
    .map(({ id, role, yoe_min, yoe_confidence }) => ({ id, role, yoe_min, yoe_confidence }));
  if (apply && changes.length) {
    await inTransaction(async client => {
      for (const change of changes)
        await client.query(
          'UPDATE job_descriptions SET yoe_min = $2, yoe_confidence = $3 WHERE job_id = $1::bigint',
          [change.id, change.yoe_min, change.yoe_confidence],
        );
    });
  }
  return {
    mode: apply ? 'apply' : 'dry-run',
    scope: all ? 'all' : 'unestimated',
    scanned: results.length,
    changed: changes.length,
    written: apply ? changes.length : 0,
    byConfidence: counts,
    sample,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const jobArg = process.argv.find(arg => arg.startsWith('--job='))?.slice(6) ?? null;
  if (jobArg !== null && !/^\d+$/.test(jobArg)) throw new Error('Invalid job ID');
  try {
    const summary = await backfillYoe({
      apply: process.argv.includes('--apply'),
      all: process.argv.includes('--all'),
      jobId: jobArg,
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await close();
  }
}
