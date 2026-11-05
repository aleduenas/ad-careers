#!/usr/bin/env node
// Read-only pipeline inspection utility. Windows-compatible — no shell required.
//
// Usage:
//   node src/helpers/inspect-pipeline.mjs jobs       -- dump all jobs from PostgreSQL
//   node src/helpers/inspect-pipeline.mjs job ID     -- dump one job by permanent ID
//   node src/helpers/inspect-pipeline.mjs cache      -- list cached JDs under data/jds/

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { query, close } from '../lib/_database.mjs';
import { root } from '../lib/root.mjs';
const [, , cmd] = process.argv;

switch (cmd) {
  case 'jobs':
  case 'status':
    try {
      console.log(JSON.stringify(await query('SELECT * FROM jobs ORDER BY id'), null, 2));
    } finally {
      await close();
    }
    break;
  case 'job':
    try {
      console.log(
        JSON.stringify(await query('SELECT * FROM jobs WHERE id=$1', [process.argv[3]]), null, 2),
      );
    } finally {
      await close();
    }
    break;
  case 'cache': {
    const jdsDir = join(root, 'data', 'jds');
    if (!existsSync(jdsDir)) {
      console.log('data/jds/ does not exist — no JDs cached yet');
      break;
    }
    const companies = readdirSync(jdsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
    if (companies.length === 0) {
      console.log('data/jds/ is empty');
      break;
    }
    let total = 0;
    for (const company of companies) {
      const files = readdirSync(join(jdsDir, company)).filter(f => f.endsWith('.md'));
      total += files.length;
      console.log(`  ${company}/  (${files.length} JD${files.length !== 1 ? 's' : ''})`);
      for (const f of files) console.log(`    ${f}`);
    }
    console.log(
      `\nTotal: ${total} cached JD${total !== 1 ? 's' : ''} across ${companies.length} ${companies.length !== 1 ? 'companies' : 'company'}`,
    );
    break;
  }

  default:
    console.log('Usage: node src/helpers/inspect-pipeline.mjs <command>');
    console.log('Commands:');
    console.log('  jobs      — dump all jobs from PostgreSQL');
    console.log('  job ID    — dump one job by permanent ID');
    console.log('  cache     — list cached JDs under data/jds/');
    process.exit(cmd ? 1 : 0);
}
