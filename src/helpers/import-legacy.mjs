// One-time recovery/import boundary. Operational code must not import this module.
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { root, urlKey, transaction, close } from '../lib/_database.mjs';
import { findCachedJD } from '../lib/_cached-jd.mjs';

export function audit(base) {
  const files = [
    'data/pipeline.md',
    'data/applications.md',
    'data/id-counter',
    'data/scan-history.tsv',
  ];
  const read = p => (existsSync(join(base, p)) ? readFileSync(join(base, p), 'utf8') : '');
  const jobs = new Map(),
    errors = [],
    warnings = [],
    reassigned = [];
  if (!existsSync(join(base, files[0])) && !existsSync(join(base, files[1])))
    errors.push('No source files remain. Import may already be archived; use database inspection.');
  let nextId = Number(read(files[2]).trim()) || 0;
  const resolutions = JSON.parse(read('config/database-import.json') || '{}');
  let section = '';
  for (const line of read(files[0]).split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim().split(' ')[0];
      continue;
    }
    if (!line.startsWith('- ')) continue;
    const m = line.match(/^- (\d+) \| (\S+) \| ([^|]*?) \| ([^|]*?)(?: \| (.*))?$/);
    if (!m) {
      errors.push('Unparseable pipeline record: ' + line);
      continue;
    }
    const [, rawId, url, company, role, extra] = m;
    const id = String(Number(rawId));
    nextId = Math.max(nextId, Number(id));
    if (jobs.has(id)) {
      errors.push('Duplicate pipeline ID ' + id);
      continue;
    }
    jobs.set(id, {
      id,
      company,
      role,
      url,
      status:
        section === 'Processed'
          ? extra?.startsWith('DISCARDED')
            ? 'Discarded'
            : 'Evaluated'
          : 'Pending',
      notes: '',
      score: extra?.match(/^([\d.]+)\/5$/) ? Number(extra.split('/')[0]) : null,
      report_path: null,
      source_date: null,
      evaluation_error: section === 'Errors' ? extra : null,
    });
  }
  const trackerIds = new Set();
  for (const line of read(files[1]).split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      continue;
    }
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const fields = line
      .split('|')
      .slice(1, -1)
      .map(s => s.trim());
    if (fields.length !== 7) {
      errors.push('Malformed tracker record ' + fields[0]);
      continue;
    }
    const [rawId, date, company, role, score, report, notes] = fields;
    const id = String(Number(rawId));
    if (trackerIds.has(id)) {
      errors.push('Duplicate tracker ID ' + id);
      continue;
    }
    trackerIds.add(id);
    const old = jobs.get(id);

    const reportLink = report.match(/\[(\d+)\]\(([^)]+)\)/);
    if (reportLink && Number(reportLink[1]) !== Number(id)) errors.push('Report ID mismatch ' + id);
    const reportPath = reportLink
      ? relative(base, resolve(base, 'data', reportLink[2])).replaceAll('\\', '/')
      : null;
    if (reportPath?.startsWith('..')) {
      errors.push('Report escapes repository ' + id);
      continue;
    }
    const reportBody = reportPath ? read(reportPath) : '';
    if (reportPath && !reportBody) warnings.push('Missing report for ' + id + ': ' + reportPath);
    const reportUrl = reportBody.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+|local:\S+)/m)?.[1];
    let url = old?.url || reportUrl || notes.match(/https?:\/\/\S+/)?.[0] || null;
    if (old?.url && reportUrl && urlKey(old.url) !== urlKey(reportUrl)) {
      // Explicitly approved repair: retain the existing evaluated report ID.
      const approved = resolutions.id_conflicts?.[id];
      if (
        approved?.resolution === 'preserve_tracker_id_reassign_pipeline' &&
        company === approved.tracker_company &&
        old.url.includes(approved.pipeline_url_contains)
      ) {
        const newId = String(++nextId);
        jobs.set(newId, { ...old, id: newId });
        reassigned.push({ from: id, to: newId, company: old.company, role: old.role });
        url = reportUrl;
      } else errors.push('Conflicting URL for ID ' + id);
    }
    jobs.set(id, {
      id,
      company,
      role,
      url,
      status: section,
      notes,
      score: /^\d+(\.\d+)?\/5$/.test(score) ? Number(score.split('/')[0]) : null,
      report_path: reportPath,
      source_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      evaluation_error: old?.evaluation_error || null,
    });
  }
  const identities = new Map(),
    removedDuplicates = [];
  for (const job of jobs.values()) {
    if (job.status === 'SKIP') job.status = 'Discarded';
    if (
      ![
        'Pending',
        'Evaluated',
        'Applied',
        'Interview',
        'Offer',
        'Rejected',
        'Discarded',
        'Ghosted',
      ].includes(job.status)
    )
      errors.push('Unknown status ' + job.status + ' for ' + job.id);
    const appliedDate =
      job.status === 'Applied' ? job.notes.match(/Applied\s+(\d{4}-\d{2}-\d{2})/i) : null;
    if (appliedDate) job.applied_at = appliedDate[1];
    job.url_key = urlKey(job.url);
    if (job.url_key && identities.has(job.url_key)) {
      const other = jobs.get(identities.get(job.url_key));
      const rank = j =>
        ({
          Pending: 0,
          Evaluated: 1,
          Discarded: 2,
          Applied: 3,
          Ghosted: 4,
          Interview: 5,
          Rejected: 6,
          Offer: 7,
        })[j.status];
      const keep =
        rank(job) > rank(other) || (rank(job) === rank(other) && Number(job.id) > Number(other.id))
          ? job
          : other;
      const drop = keep === job ? other : job;
      removedDuplicates.push({ removed: drop.id, kept: keep.id, url: job.url });
      jobs.delete(drop.id);
      identities.set(job.url_key, keep.id);
      if (drop === job) continue;
    }
    if (job.url_key) identities.set(job.url_key, job.id);
    const jd = findCachedJD(base, { ...job, num: job.id });
    job.jd_path = jd ? relative(base, jd).replaceAll('\\', '/') : null;
  }
  const history = read(files[3])
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map(line => {
      const a = line.split('\t');
      return [
        a[0],
        /^\d{4}-\d{2}-\d{2}$/.test(a[1]) ? a[1] : null,
        ...[2, 3, 4, 5, 6].map(i => a[i] || ''),
      ];
    });
  const pendingDir = join(base, 'batch/tracker-additions');
  const outstanding = existsSync(pendingDir)
    ? readdirSync(pendingDir).filter(f => f.endsWith('.tsv'))
    : [];
  if (outstanding.length)
    errors.push('Unmerged evaluation outputs require reconciliation: ' + outstanding.join(', '));
  const fingerprint = createHash('sha256')
    .update(files.map(f => f + '\n' + read(f)).join('\n') + JSON.stringify(resolutions))
    .digest('hex');
  return {
    files,
    reassigned,
    removedDuplicates,
    jobs: [...jobs.values()],
    history,
    errors,
    warnings,
    fingerprint,
    lastAllocated: Math.max(nextId, ...[...jobs.keys()].map(Number), 0),
  };
}

export async function importRecords(result, runTransaction = transaction) {
  if (result.errors.length) throw new Error('Import audit failed; source files unchanged.');
  await runTransaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(71938201)');
    if (
      (await c.query('SELECT 1 FROM legacy_imports WHERE fingerprint=$1', [result.fingerprint]))
        .rowCount
    )
      return;
    if (Number((await c.query('SELECT count(*) FROM jobs')).rows[0].count))
      throw new Error('Import requires an empty database or the identical completed import.');
    for (const j of result.jobs) {
      const keys = Object.keys(j);
      await c.query(
        'INSERT INTO jobs(' +
          keys.join(',') +
          ') VALUES(' +
          keys.map((_, i) => '$' + (i + 1)).join(',') +
          ')',
        Object.values(j),
      );
    }
    for (const j of result.jobs) {
      await c.query(
        "INSERT INTO job_status_events(job_id,new_status,reason,actor,occurred_at) VALUES($1,$2,'Imported historical state; original transition timestamp unknown','migration',NULL)",
        [j.id, j.status],
      );
      if (j.report_path)
        await c.query(
          'INSERT INTO evaluations(job_id,operation_key,score,report_path,result_status) VALUES($1,$2,$3,$4,$5)',
          [
            j.id,
            'legacy:' + result.fingerprint + ':' + j.id,
            j.score,
            j.report_path,
            j.status === 'Discarded' ? 'Discarded' : 'Evaluated',
          ],
        );
    }
    for (const row of result.history)
      await c.query(
        'INSERT INTO scan_history(url,first_seen,portal,title,company,status,location) VALUES($1,$2,$3,$4,$5,$6,$7)',
        row,
      );
    for (const j of result.jobs) {
      const actual = (await c.query('SELECT * FROM jobs WHERE id=$1', [j.id])).rows[0];
      for (const [key, value] of Object.entries(j)) {
        const got =
          actual[key] instanceof Date ? actual[key].toISOString().slice(0, 10) : actual[key];
        if (String(got) !== String(value))
          throw new Error('Import parity failure ' + j.id + ' ' + key);
      }
    }
    if (
      Number((await c.query('SELECT count(*) FROM scan_history')).rows[0].count) !==
      result.history.length
    )
      throw new Error('Scan-history count mismatch');
    await c.query("SELECT setval(pg_get_serial_sequence('jobs','id'),$1,$2)", [
      Math.max(1, result.lastAllocated),
      result.lastAllocated > 0,
    ]);
    await c.query('INSERT INTO legacy_imports(fingerprint,job_count) VALUES($1,$2)', [
      result.fingerprint,
      result.jobs.length,
    ]);
  });
}

async function main() {
  const result = audit(root);
  console.log(
    JSON.stringify(
      {
        jobs: result.jobs.length,
        scan_records: result.history.length,
        reassigned: result.reassigned,
        removed_duplicates: result.removedDuplicates,
        errors: result.errors,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes('--apply')) {
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  if (result.errors.length) throw new Error('Import audit failed; source files unchanged.');
  const backup = join(root, 'data/archive/postgres-import-' + result.fingerprint.slice(0, 12));
  mkdirSync(backup, { recursive: true });
  for (const f of result.files)
    if (existsSync(join(root, f))) copyFileSync(join(root, f), join(backup, f.split('/').at(-1)));
  await importRecords(result);
  if (process.argv.includes('--archive')) {
    if (audit(root).fingerprint !== result.fingerprint)
      throw new Error('Source changed after import; refusing retirement');
    for (const f of result.files)
      if (existsSync(join(root, f)))
        renameSync(join(root, f), join(backup, 'retired-' + f.split('/').at(-1)));
    for (const f of [
      'batch/tracker-additions',
      'batch/batch-manifest.json',
      'batch/.finalize.lock',
    ]) {
      const source = resolve(root, f);
      if (!relative(root, source) || relative(root, source).startsWith('..'))
        throw new Error('Unsafe archive target');
      if (existsSync(source)) renameSync(source, join(backup, 'retired-' + f.split('/').at(-1)));
    }
  }
  console.log('Import verified. Backup: ' + relative(root, backup));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(root, 'src/helpers/import-legacy.mjs'))
  main()
    .catch(e => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(close);
