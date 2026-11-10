import { readFile, stat } from 'node:fs/promises';
import { inspectSafeFile } from './jobs-paths.mjs';

const MAX_REPORT_BYTES = 1024 * 1024;
const CURRENT_BAND = /^\*\*Compensation band:\*\*\s*(.+)$/im;
const HISTORICAL_BAND = /\*\*Comp\*\*\s*\|\s*(.+)/i;

function projectedBand(text) {
  const match = CURRENT_BAND.exec(text) || HISTORICAL_BAND.exec(text);
  if (!match) return { text: null, state: 'invalid' };
  const value = match[1].trim().replace(/\|+$/, '').trim();
  const lower = value.toLowerCase();
  if (lower.startsWith('unknown') || lower === 'not assessed')
    return { text: null, state: 'missing' };
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return { text: null, state: 'invalid' };
  return { text: value.slice(0, 300), state: 'report' };
}

export async function readReportCompensation(row, rootDir) {
  if (!row?.report_path) return { text: null, state: 'missing' };
  const relativePath = String(row.report_path);
  const inspected = await inspectSafeFile(rootDir, relativePath, ['data/evaluations', 'output']);
  if (inspected?.status !== 'ok')
    return { text: null, state: inspected?.status === 'missing' ? 'missing' : 'invalid' };
  const safe = inspected;
  const info = await stat(safe.path).catch(() => null);
  if (!info || info.size > MAX_REPORT_BYTES) return { text: null, state: 'invalid' };
  const bytes = await readFile(safe.path).catch(() => null);
  if (!bytes || bytes.length > MAX_REPORT_BYTES) return { text: null, state: 'invalid' };
  return projectedBand(bytes.toString('utf8'));
}
