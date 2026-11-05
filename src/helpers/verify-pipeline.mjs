#!/usr/bin/env node
import { query, close, root } from '../lib/_database.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
try {
  const jobs = await query('SELECT id,status,report_path,jd_path FROM jobs');
  const missing = jobs.flatMap(j =>
    ['report_path', 'jd_path']
      .filter(k => j[k] && !existsSync(join(root, j[k])))
      .map(k => '#' + j.id + ' missing ' + k + ': ' + j[k]),
  );
  console.log(JSON.stringify({ jobs: jobs.length, missing_artifacts: missing }, null, 2));
  if (missing.length) process.exitCode = 1;
} finally {
  await close();
}
