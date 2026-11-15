import type { JobItem } from '../api';

export function formatDate(value: string | null) {
  if (!value) return 'Unknown';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Unknown';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return /^d{4}-d{2}-d{2}$/.test(value)
    ? formatDate(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const salaryWhole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });

const salaryCents = new Intl.NumberFormat('en-CA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatSalary(salary: JobItem['salary']) {
  if (!salary) return null;
  // Same precision for both ends: cents only when either end has a fractional part.
  const fractional = [salary.min, salary.max].some(
    value => value !== null && !Number.isInteger(Number(value)),
  );
  const format = fractional ? salaryCents : salaryWhole;
  const part = (value: string | null) => (value === null ? null : format.format(Number(value)));
  const min = part(salary.min);
  const max = part(salary.max);
  if (min && max) return `${min} – ${max}`;
  if (min) return `from ${min}`;
  if (max) return `up to ${max}`;
  return null;
}

// One phrase per state: no evaluation yet -> "Not evaluated"; a report with no readable pay figure
// (missing or invalid) -> "Not stated".
export function compensationText(job: JobItem) {
  if (job.status === 'Pending') return 'Not evaluated';
  return (
    job.compensation.text ??
    (job.compensation.state === 'missing' || job.compensation.state === 'invalid'
      ? 'Not stated'
      : 'Not evaluated')
  );
}

export function scoreText(score: number | null, pending = false) {
  if (pending || score === null) return '—';
  return score.toFixed(1);
}

export function formatPercent(value: number) {
  return `${Number(value.toFixed(1))}%`;
}
