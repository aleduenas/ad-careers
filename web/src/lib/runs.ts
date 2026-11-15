import { useEffect, useRef, useState } from 'react';
import type { RunRecord, ScanReport, ProviderFunctionName, ProviderKey } from '../api';
import { api } from './client';
import { providerLabels, functionRows } from './providers';

export const functionLabel = (name: ProviderFunctionName) =>
  functionRows.find(row => row.key === name)?.label ?? name;

// Public run error codes in plain words. The code itself stays in a title attribute and in the
// run detail; an unknown code reads as a generic sentence.
const runErrorText: Record<string, string> = {
  EXIT_NONZERO: 'The worker ended with an error.',
  SPAWN_FAILED: 'The worker could not be started.',
  QUEUE_STALE: 'The run was queued but never started.',
  PROCESS_GONE: 'The worker stopped and the server can no longer see it.',
  LOCATION_REVIEW: 'Needs a location decision.',
  STALE_24H: 'The run was last seen running more than a day ago.',
};

export const errorText = (code: string) => runErrorText[code] ?? 'The run did not finish.';

/**
 * An evaluate run that stopped only because the job needs a location decision. It is stored as a
 * failed run (errorCode LOCATION_REVIEW) but is not a failure: every place that shows an outcome
 * derives its wording and styling from these three helpers.
 */
export const LOCATION_REVIEW = 'LOCATION_REVIEW';
export const needsLocationDecision = (run: Pick<RunRecord, 'state' | 'errorCode'>) =>
  run.state === 'failed' && run.errorCode === LOCATION_REVIEW;
/** The word shown in a run's state badge. */
export const stateText = (run: Pick<RunRecord, 'state' | 'errorCode'>) =>
  needsLocationDecision(run) ? 'Needs a location decision' : run.state;
/** The badge class: a location decision uses its own neutral style, not the failed one. */
export const stateClass = (run: Pick<RunRecord, 'state' | 'errorCode'>) =>
  needsLocationDecision(run) ? 'run-badge run-review' : `run-badge run-${run.state}`;

export const runActionLabel: Record<string, string> = {
  evaluate: 'Evaluate',
  cv: 'Draft CV',
  letter: 'Draft cover letter',
  scan: 'Scan',
  liveness: 'Posting check',
  intake: 'Intake',
  publish: 'Publish',
  both: 'Draft both (legacy)',
};

export const isActiveRun = (run: RunRecord) => run.state === 'queued' || run.state === 'running';

export function selectionText(selection: RunRecord['selection']): string | null {
  if (!selection) return null;
  const parts = (Object.keys(selection) as ProviderFunctionName[])
    .filter(name => selection[name])
    .map(name => {
      const item = selection[name];
      return item ? `${functionLabel(name)}: ${providerLabels[item.provider]} / ${item.model}` : '';
    })
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export const summaryLabels: [keyof ScanReport['summary'], string][] = [
  ['jobsFound', 'Jobs found'],
  ['newOffers', 'New offers'],
  ['missingFullJd', 'Missing full JD'],
  ['structured', 'Structured sources'],
  ['richOnly', 'Rich-only sources'],
  ['unclassified', 'Unclassified'],
  ['ok', 'Sources ok'],
  ['empty', 'Sources empty'],
  ['error', 'Sources with errors'],
];

// ---- Package 3.6: Tasks page, global active-run indicator and Start again.
// States are shown exactly as the server reports them. There is no Resume or Cancel: the launchers
// support neither. Start again opens the same dialog a first start uses and sends a fresh key.

export const TASK_BASE_LIMIT = 12;

export const TASK_MORE_LIMIT = 50;

export type RunsMonitor = {
  runs: RunRecord[];
  loaded: boolean;
  reconnecting: boolean;
  failed: boolean;
  refresh: () => void;
};

export function useRunsMonitor(enabled: boolean, limit: number): RunsMonitor {
  const [state, setState] = useState({
    runs: [] as RunRecord[],
    loaded: false,
    reconnecting: false,
    failed: false,
  });
  const [tick, setTick] = useState(0);
  const activeRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await api.runs(controller.signal, undefined, limit);
        if (cancelled) return;
        activeRef.current = result.data.runs.some(isActiveRun);
        setState({ runs: result.data.runs, loaded: true, reconnecting: false, failed: false });
      } catch {
        if (cancelled) return;
        // A failed poll never clears what is already shown.
        setState(previous => ({
          ...previous,
          reconnecting: previous.loaded,
          failed: !previous.loaded,
        }));
      }
      if (!cancelled) timer = window.setTimeout(poll, activeRef.current ? 3000 : 15000);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, limit, tick]);
  return { ...state, refresh: () => setTick(value => value + 1) };
}

export function orderRuns(runs: RunRecord[]): RunRecord[] {
  const time = (run: RunRecord) => Date.parse(run.createdAt) || 0;
  return [...runs].sort((a, b) => {
    const rank = Number(isActiveRun(b)) - Number(isActiveRun(a));
    return rank || time(b) - time(a) || b.id.localeCompare(a.id);
  });
}

export function runDuration(run: RunRecord, now: number): string {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN;
  if (Number.isNaN(start)) return '—';
  const end = run.finishedAt ? Date.parse(run.finishedAt) : run.state === 'running' ? now : NaN;
  if (Number.isNaN(end)) return '—';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function primarySelection(run: RunRecord): string {
  const selection = run.selection as Record<
    string,
    { provider: ProviderKey; model: string } | undefined
  > | null;
  if (!selection) return '—';
  for (const key of ['evaluation', 'cv', 'coverLetter']) {
    const item = selection[key];
    if (item && providerLabels[item.provider]) {
      return `${providerLabels[item.provider]} / ${item.model}`;
    }
  }
  return '—';
}

export const interruptedCopy =
  'Interrupted: the worker stopped, or the server could not observe it any more. Nothing was resumed.';
