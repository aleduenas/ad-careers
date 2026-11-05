#!/usr/bin/env node
// Turns a dashboard-pasted JD into a normal Pending job without changing its
// body. The dashboard owns the URL, canonical company name and role title.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJob, query, urlKey } from '../lib/_database.mjs';
import { slugify, jdStoragePath, loadSeenUrls, appendToScanHistory } from './scan.mjs';

import { root } from '../lib/root.mjs';
const text = value => (typeof value === 'string' ? value.trim() : '');

export function normalizeUrl(raw) {
  let value = String(raw || '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '');
  value = value.replace(/^[<"'\s]+|[>"'\s]+$/g, '');
  if (!value) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname ? value : '';
  } catch {
    return '';
  }
}

const companyKey = value =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Preserve an existing spelling only when the user's entry has one unambiguous
// normalized match. We never fuzzy-match names such as TD and TD Bank.
export async function canonicalCompany(input) {
  const entered = text(input);
  const key = companyKey(entered);
  if (!key) return '';
  const rows = await query(`
    SELECT DISTINCT trim(company) AS company FROM jobs WHERE trim(company) <> ''
    UNION
    SELECT DISTINCT trim(company) AS company FROM scan_history WHERE trim(company) <> ''
  `);
  const matches = [
    ...new Set(rows.map(row => text(row.company)).filter(name => companyKey(name) === key)),
  ];
  return matches.length === 1 ? matches[0] : entered;
}

export function rawJDDocument({ company, role, url, body, date }) {
  return `---\ncompany: ${company}\nrole: ${role}\nurl: ${url}\nsource: manual-paste\nfetched: ${date}\n---\n\n${body}`;
}

function saveRawJD(company, role, url, body, date) {
  const filePath = jdStoragePath(company, role, url);
  if (existsSync(filePath)) return filePath;
  mkdirSync(join(root, 'data', 'jds', slugify(company)), { recursive: true });
  writeFileSync(filePath, rawJDDocument({ company, role, url, body, date }), 'utf8');
  return filePath;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    fail('Invalid input: expected JSON {url, company, role, text} on stdin');
    return;
  }
  const url = normalizeUrl(payload.url);
  const requestedCompany = text(payload.company);
  const role = text(payload.role);
  // Retain the description byte-for-byte as entered. Only use its trimmed
  // form to decide whether there is meaningful content to ingest.
  const rawJD = typeof payload.text === 'string' ? payload.text : '';
  if (!url) fail('Invalid or missing job URL');
  if (!requestedCompany) fail('Missing company name');
  if (!role) fail('Missing role title');
  if (rawJD.trim().length < 100)
    fail('Pasted JD text is too short — paste the full job description');
  // The dashboard checks PostgreSQL itself before this script ever runs and
  // lets the user confirm past a scan-only sighting (payload.force). This is
  // the safety net for direct/CLI invocation: a real jobs-table duplicate is
  // never bypassable, since createJob would otherwise silently resync that
  // job's JD; a scan_history-only sighting honors an explicit force.
  const alreadyJob = (await query('SELECT 1 FROM jobs WHERE url_key=$1', [urlKey(url)])).length > 0;
  if (alreadyJob) fail('This URL already belongs to a tracked job — skipping to avoid a duplicate');
  if (!payload.force && (await loadSeenUrls()).has(url))
    fail(
      'This URL was seen in a past scan but never tracked as a job — resubmit with force to continue',
    );

  const company = await canonicalCompany(requestedCompany);
  const date = new Date().toISOString().slice(0, 10);
  if (process.argv.includes('--dry-run')) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        company,
        role,
        url,
        jd_path: jdStoragePath(company, role, url),
      }),
    );
    return;
  }
  const jdPath = saveRawJD(company, role, url, rawJD, date);
  const { id } = await createJob({ company, role, url, jd_path: jdPath, source_date: date });
  await appendToScanHistory([{ url, source: 'manual-paste', title: role, company }], date, 'added');
  console.log(`Added #${id} — ${company} — ${role} (${jdPath}; JD saved verbatim)`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => fail(error?.message || String(error)));
}
