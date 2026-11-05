#!/usr/bin/env node
import { query, close } from '../lib/_database.mjs';
const args = process.argv.slice(2),
  n = Number(args.find(a => /^\d+$/.test(a)) || 10);
const terms = args
  .find(a => a.startsWith('--select='))
  ?.slice(9)
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);
const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
try {
  const idArg = args.find(a => a.startsWith('--id='))?.slice(5);
  const selected = idArg
    ? await query("SELECT * FROM jobs WHERE status='Pending' AND id=$1", [idArg])
    : terms
      ? await query(
          "SELECT * FROM jobs WHERE status='Pending' AND EXISTS(SELECT 1 FROM unnest($1::text[]) term WHERE strpos(lower(company||' '||role),term)>0) ORDER BY id",
          [terms],
        )
      : await query("SELECT * FROM jobs WHERE status='Pending' ORDER BY id LIMIT $1", [n]);
  const jobs = selected.map(j => ({
    num: String(j.id),
    company: j.company,
    role: j.role,
    url: j.url,
    jd_path: j.jd_path,
    revision: j.revision,
    slug: slug(j.company + ' ' + j.role),
    report_path:
      'data/evaluations/' +
      j.id +
      '-' +
      slug(j.company + ' ' + j.role) +
      '-' +
      new Date().toISOString().slice(0, 10) +
      '.md',
  }));
  console.log(
    args.includes('--json')
      ? JSON.stringify({ count: jobs.length, jobs }, null, 2)
      : jobs.map(j => '#' + j.num + ' ' + j.company + ' — ' + j.role).join('\n'),
  );
} finally {
  await close();
}
