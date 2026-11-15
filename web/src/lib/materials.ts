import type { JobDetailResponse, MaterialKey } from '../api';

export const materialLabels: Record<MaterialKey, string> = {
  cv: 'CV',
  letter: 'Cover letter',
  brief: 'Cover letter brief',
  prep: 'Interview prep',
};

export const reportMessages = {
  missing: 'No evaluation report file is available for this job.',
  invalid: 'The evaluation report could not be read or is too large to show.',
  unsafe: 'The evaluation report path is outside the allowed folders, so it was not opened.',
} as const;

// The server writes one actor per change; map the known ones to what a reader understands.
const actorLabels: Record<string, string> = {
  browser: 'You (browser)',
  dashboard: 'Terminal dashboard',
  'dashboard-auto': 'Automatic ghosting',
  cli: 'Command line',
  evaluation: 'Evaluation',
  migration: 'Migration',
  scan: 'Scan',
  intake: 'Intake',
};

export function actorLabel(actor: string) {
  if (!actor) return '—';
  return actorLabels[actor] ?? actor;
}

export function materialHref(id: string, key: MaterialKey, name?: string) {
  return `/api/v1/jobs/${id}/materials/${key}${name ? `/${encodeURIComponent(name)}` : ''}`;
}

// ---- Package 3.2: workspace editing (status, metadata, JD). Rendered only when the session says
// jobWrites is true; nothing here starts a worker.

export type DetailData = JobDetailResponse['data'];
