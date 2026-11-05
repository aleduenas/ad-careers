import { getJob, query, close } from '../lib/_database.mjs';
const [id, ...args] = process.argv.slice(2);
if (!/^\d+$/.test(id || '') || !args.length || args.some(a => !/^--(role|note|revision)=/.test(a)))
  throw new Error('Usage: job-update.mjs ID --role=TITLE --note=TEXT [--revision=N]');
const options = Object.fromEntries(
  args.map(a => {
    const i = a.indexOf('=');
    return [a.slice(2, i), a.slice(i + 1)];
  }),
);
try {
  const job = await getJob(id);
  console.log(
    JSON.stringify(
      (
        await query('SELECT * FROM update_job_metadata($1,$2,$3,$4)', [
          id,
          options.revision ?? job.revision,
          options.role ?? null,
          options.note ?? null,
        ])
      )[0],
    ),
  );
} finally {
  await close();
}
