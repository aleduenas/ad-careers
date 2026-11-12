import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { urlKey } from '../lib/_database.mjs';
import { root } from '../lib/root.mjs';
import { createIntakeService } from './intake.mjs';
import { createDiscoveryLock, createRunsService, LAUNCHERS } from './runs.mjs';
import { createRunsStore } from './runs-store.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIPPED PostgreSQL intake and scan integration: TEST_DATABASE_URL is required (personal database never used)',
  );
  process.exit(0);
}
const parsed = new URL(url);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(parsed.pathname))
  throw new Error('Test database name must start career_ops_test_; refusing personal database');

const schema = 'test_intake_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: url });
let pool;
let schemaCreated = false;
let tempRoot;
const createdFolders = new Set();
const marker = randomUUID().slice(0, 8);

async function until(check, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('timed out waiting for ' + label);
}

const reject = async (promise, check) => {
  await assert.rejects(promise, error => {
    check(error);
    return true;
  });
};

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await admin.query(`SET search_path TO "${schema}"`);
  for (const name of readdirSync(join(root, 'infra/sql/migrations'))
    .filter(n => n.endsWith('.sql'))
    .sort())
    await admin.query(readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'));
  const poolUrl = new URL(url);
  poolUrl.searchParams.set('options', `-c search_path=${schema}`);
  pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 6 });
  const rows = async (sql, args = []) => (await pool.query(sql, args)).rows;
  // The launcher child process gets the isolated schema through DATABASE_URL.
  const childEnv = { ...process.env, DATABASE_URL: poolUrl.toString() };
  const lock = createDiscoveryLock();
  tempRoot = await mkdtemp(join(tmpdir(), 'career-ops-intake-db-'));
  const store = createRunsStore({ query: (sql, args) => pool.query(sql, args) });
  const runs = createRunsService({ store, query: rows, rootDir: tempRoot, discoveryLock: lock });
  const intake = createIntakeService({
    query: rows,
    env: childEnv,
    discoveryLock: lock,
    activeScanRunId: () => runs.activeScan(),
  });

  const company = `Zz Intake ${marker}`;
  const link = path => `https://example.test/${marker}/${path}`;
  const newJob = async (name, role, address) =>
    (
      await rows('SELECT * FROM create_job($1,$2,$3,$4,NULL,$5::date)', [
        name,
        role,
        address,
        urlKey(address),
        '2026-10-01',
      ])
    )[0];
  const tracked = await newJob(company, 'Existing Role', link('tracked/'));
  await rows(
    "INSERT INTO scan_history (url, first_seen, portal, title, company, status) VALUES ($1,'2026-09-15','fixture','Seen Title',$2,'skipped_title')",
    [link('seen'), 'Seen Only Co'],
  );
  await rows(
    "INSERT INTO scan_history (url, first_seen, portal, title, company, status) VALUES ($1,'2026-08-01','fixture','Older','Seen Only Co','added'), ($1,'2026-09-20','fixture','Newer','Seen Only Co','skipped_location')",
    [link('twice')],
  );

  // check: tracked, seen (latest sighting), neither, normalization, bad input.
  const hit = await intake.check({ url: link('tracked') });
  assert.deepEqual(hit.tracked, {
    id: String(tracked.id),
    company,
    role: 'Existing Role',
    status: 'Pending',
  });
  const viaWww = await intake.check({ url: link('tracked/').replace('https://', 'https://www.') });
  assert.equal(viaWww.tracked?.id, String(tracked.id), 'scheme and www do not matter');
  const seen = await intake.check({ url: link('seen') });
  assert.deepEqual(seen.seen, {
    company: 'Seen Only Co',
    title: 'Seen Title',
    status: 'skipped_title',
    firstSeen: '2026-09-15',
  });
  assert.equal(seen.tracked, null);
  assert.equal(
    (await intake.check({ url: link('twice') })).seen.title,
    'Newer',
    'the newest sighting is reported',
  );
  assert.deepEqual(await intake.check({ url: link('nothing') }), {
    url: link('nothing'),
    tracked: null,
    seen: null,
  });
  assert.deepEqual(await intake.check({ url: 'not a url' }), {
    url: null,
    tracked: null,
    seen: null,
  });

  // companies: both tables, normalized prefix, distinct.
  assert.deepEqual((await intake.companies({ q: 'zz intake' })).companies.includes(company), true);
  assert.deepEqual((await intake.companies({ q: 'seenonly' })).companies, ['Seen Only Co']);

  const text =
    `Synthetic description for ${marker}.   \r\nSecond line with trailing spaces   \n\tTabbed line.\n`.repeat(
      4,
    );
  const payload = (extra = {}) => ({
    url: link('new-role'),
    company,
    role: 'Platform Engineer',
    text,
    ...extra,
  });
  const jdFolder = join(root, 'data', 'jds');
  const before = {
    jobs: JSON.stringify(await rows('SELECT id FROM jobs ORDER BY id')),
    history: JSON.stringify(await rows('SELECT url FROM scan_history ORDER BY id')),
  };

  // A real launcher dry run: canonical company spelling, planned path, nothing written.
  const preview = await intake.preview(payload({ company: company.toLowerCase() }));
  assert.equal(preview.company, company, 'an unambiguous existing spelling is kept');
  assert.equal(preview.role, 'Platform Engineer');
  assert.equal(preview.url, link('new-role'));
  assert.match(preview.jdPath, /^data\/jds\/zz-intake-[0-9a-f]+\/platform-engineer\.md$/);
  createdFolders.add(join(root, dirname(preview.jdPath)));
  assert.equal(existsSync(join(root, preview.jdPath)), false, 'a dry run writes no file');
  assert.equal(
    JSON.stringify(await rows('SELECT id FROM jobs ORDER BY id')),
    before.jobs,
    'a dry run creates no job',
  );
  assert.equal(
    JSON.stringify(await rows('SELECT url FROM scan_history ORDER BY id')),
    before.history,
  );

  // Launcher validation, through the real script.
  await reject(intake.preview(payload({ text: 'too short' })), error => {
    assert.equal(error.statusCode, 400);
    assert.deepEqual(Object.keys(error.fields), ['text']);
  });
  await reject(intake.preview(payload({ role: '   ' })), error =>
    assert.deepEqual(Object.keys(error.fields), ['role']),
  );
  await reject(intake.preview(payload({ company: '' })), error =>
    assert.deepEqual(Object.keys(error.fields), ['company']),
  );
  await reject(intake.preview(payload({ url: 'ftp://bad.example/x' })), error =>
    assert.deepEqual(Object.keys(error.fields), ['url']),
  );
  // A tracked URL is never bypassable, even with force.
  for (const force of [false, true])
    await reject(intake.preview(payload({ url: link('tracked'), force })), error => {
      assert.equal(error.publicCode, 'DUPLICATE_JOB');
      assert.equal(error.current.tracked.id, String(tracked.id));
    });
  // A scan-only sighting needs force.
  await reject(intake.preview(payload({ url: link('seen') })), error => {
    assert.equal(error.publicCode, 'SEEN_URL');
    assert.equal(error.current.seen.title, 'Seen Title');
  });
  const forced = await intake.preview(payload({ url: link('seen'), force: true }));
  assert.equal(forced.url, link('seen'));

  // A real intake: a Pending job with the JD verbatim, a manual-paste history row, a workspace id.
  const added = await intake.add(payload());
  createdFolders.add(join(root, dirname(added.jdPath)));
  assert.equal(added.company, company);
  assert.equal(added.role, 'Platform Engineer');
  assert.match(added.id, /^[1-9][0-9]*$/);
  const job = (
    await rows('SELECT id::text AS id, company, role, url, status, jd_path FROM jobs WHERE id=$1', [
      added.id,
    ])
  )[0];
  assert.deepEqual(
    [job.company, job.role, job.url, job.status],
    [company, 'Platform Engineer', link('new-role'), 'Pending'],
  );
  const description = (
    await rows('SELECT content FROM job_descriptions WHERE job_id=$1', [added.id])
  )[0];
  assert.ok(
    description.content.includes(text),
    'the pasted text is stored byte for byte (CRLF, tabs and trailing spaces)',
  );
  assert.match(description.content, /<!-- career-ops-job-id: \d+ -->/);
  assert.ok(
    readFileSync(join(root, added.jdPath), 'utf8').includes(text),
    'the cache file keeps the text verbatim',
  );
  const history = (
    await rows('SELECT status, portal FROM scan_history WHERE url=$1', [link('new-role')])
  )[0];
  assert.equal(history.status, 'added');
  assert.equal(lock.holder, null, 'the discovery lock is free after an intake');
  // The same URL is now a tracked duplicate.
  await reject(intake.add(payload()), error => {
    assert.equal(error.publicCode, 'DUPLICATE_JOB');
    assert.equal(error.current.tracked.id, added.id);
  });
  const checkAfter = await intake.check({ url: link('new-role') });
  assert.equal(checkAfter.tracked.id, added.id);
  // A forced intake of a seen-only URL creates its job.
  const second = await intake.add(
    payload({ url: link('seen'), force: true, role: 'Second Engineer' }),
  );
  createdFolders.add(join(root, dirname(second.jdPath)));
  assert.notEqual(second.id, added.id);

  // Scan dispatch: a synthetic scan script writes a fixture report; the report route reads it.
  const scanScript = join(tempRoot, ...LAUNCHERS.scan);
  await mkdir(dirname(scanScript), { recursive: true });
  await writeFile(
    scanScript,
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const flag = process.argv.find(arg => arg.startsWith('--report-json='));
const target = resolve(flag.slice('--report-json='.length));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify({
  schema_version: 1, generated_at: '2026-11-10T12:00:00.000Z', dry_run: process.argv.includes('--dry-run'),
  summary: { structured: 1, rich_only: 0, unclassified: 0, ok: 1, empty: 0, error: 0, jobs_found: 5, new_offers: 1, missing_full_jd: 2 },
  companies: [{ company: 'Fixture Co', classification: 'structured', provider: 'ashby-api', status: 'ok', jobs_found: 5, reason: null }],
  missing: [{ company: 'Fixture Co', title: 'Thin Posting', url: 'https://example.test/thin' }],
}));
setTimeout(() => {}, Number(process.env.SYNTH_HOLD_MS || 1500));
`,
  );
  process.env.SYNTH_HOLD_MS = '2500';
  const scan = await runs.dispatch({
    action: 'scan',
    requestKey: 'scan-' + marker,
    dryRun: true,
    company: 'Fixture',
  });
  const scanId = scan.runs[0].id;
  assert.equal(scan.runs[0].state, 'running');
  const stored = await store.get(scanId);
  assert.deepEqual(stored.selection, { dryRun: true, company: 'Fixture' });
  assert.equal(stored.jobId, null);
  // While the scan runs: a second scan and a real intake are DISCOVERY_BUSY; a preview is not.
  await reject(
    runs.dispatch({ action: 'scan', requestKey: 'scan2-' + marker, dryRun: false }),
    error => {
      assert.equal(error.publicCode, 'DISCOVERY_BUSY');
      assert.deepEqual(error.current, { activeRunId: scanId });
    },
  );
  await reject(intake.add(payload({ url: link('during-scan') })), error => {
    assert.equal(error.publicCode, 'DISCOVERY_BUSY');
    assert.deepEqual(error.current, { activeRunId: scanId });
  });
  assert.equal(
    (await intake.preview(payload({ url: link('during-scan') }))).url,
    link('during-scan'),
  );
  await until(async () => (await store.get(scanId)).state === 'completed', 'scan completion');
  const report = await runs.scanReport(scanId);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.summary.missingFullJd, 2);
  assert.deepEqual(report.missing, [
    { company: 'Fixture Co', title: 'Thin Posting', url: 'https://example.test/thin' },
  ]);
  // With the scan finished, an intake and a new scan are allowed again.
  const third = await intake.add(payload({ url: link('after-scan'), role: 'Third Engineer' }));
  createdFolders.add(join(root, dirname(third.jdPath)));
  const next = await runs.dispatch({ action: 'scan', requestKey: 'scan3-' + marker, dryRun: true });
  assert.equal(next.replayed, false);
  await until(
    async () => (await store.get(next.runs[0].id)).state === 'completed',
    'second scan completion',
  );
  assert.equal(await runs.activeScan(), null);
  console.log(
    'PostgreSQL intake and scan passed: check against tracked and seen URLs, companies, real launcher dry run and intake with verbatim text, duplicate and force rules, scan dispatch with report and discovery lock',
  );
} finally {
  await pool?.end().catch(() => {});
  for (const folder of createdFolders)
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(
      () => {},
    );
  if (tempRoot)
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 }).catch(
      () => {},
    );
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await admin.end().catch(() => {});
}
