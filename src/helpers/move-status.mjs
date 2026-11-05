#!/usr/bin/env node
import { query, getJob, close } from '../lib/_database.mjs';
const dryRun = process.argv.includes('--dry-run');
const [id, status, ...reason] = process.argv.slice(2).filter(a => a !== '--dry-run');
if (!/^\d+$/.test(id || '') || !status)
  throw new Error('Usage: node src/helpers/move-status.mjs ID STATUS [reason]');
try {
  const job = await getJob(id);
  if (dryRun)
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        id: job.id,
        revision: job.revision,
        from: job.status,
        to: status,
        reason: reason.join(' '),
      }),
    );
  else
    console.log(
      JSON.stringify(
        (
          await query('SELECT * FROM change_job_status($1,$2,$3,$4,$5)', [
            id,
            job.revision,
            status,
            reason.join(' '),
            'cli',
          ])
        )[0],
      ),
    );
} finally {
  await close();
}
