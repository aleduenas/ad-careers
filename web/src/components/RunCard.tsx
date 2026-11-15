import { useEffect, useState } from 'react';
import { letterPdfHref, type RunRecord } from '../api';
import { api } from '../lib/client';
import { formatDateTime } from '../lib/format';
import {
  errorText,
  needsLocationDecision,
  stateClass,
  stateText,
  runActionLabel,
  isActiveRun,
  selectionText,
} from '../lib/runs';

function RunLogView({ runId, active }: { runId: string; active: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let offset = 0;
    let cancelled = false;
    setText('');
    const pull = () => {
      api.runLog(runId, offset, controller.signal).then(
        result => {
          if (cancelled) return;
          offset = result.data.nextOffset;
          setText(previous => (previous + result.data.text).slice(-20000));
        },
        () => undefined,
      );
    };
    pull();
    const timer = active ? window.setInterval(pull, 3000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      controller.abort();
    };
  }, [runId, active]);
  return (
    <pre className="doc-text log-tail" tabIndex={0} aria-label="Run log tail">
      {text || 'The log is empty so far.'}
    </pre>
  );
}

// The last non-empty log lines of a failed or interrupted run, shown without a click. It reads the
// log from the start in a few bounded pulls and keeps only the tail.
function useLastLogLines(runId: string, enabled: boolean, count = 3) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let offset = 0;
    let text = '';
    (async () => {
      try {
        for (let pass = 0; pass < 8; pass += 1) {
          const result = await api.runLog(runId, offset, controller.signal);
          text = (text + result.data.text).slice(-8000);
          if (result.data.nextOffset <= offset || !result.data.text) break;
          offset = result.data.nextOffset;
        }
        if (controller.signal.aborted) return;
        setLines(
          text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .slice(-count),
        );
      } catch {
        if (!controller.signal.aborted) setLines(null);
      }
    })();
    return () => controller.abort();
  }, [runId, enabled]);
  return lines;
}

export function RunLastLines({ run }: { run: RunRecord }) {
  const failed = run.state === 'failed' || run.state === 'interrupted';
  const lines = useLastLogLines(run.id, failed);
  if (!failed || !lines || lines.length === 0) return null;
  return (
    <pre className="run-last-lines" aria-label="Last lines of the run log">
      {lines.join('\n')}
    </pre>
  );
}

export function RunCard({ run }: { run: RunRecord }) {
  const [logOpen, setLogOpen] = useState(false);
  const summary = selectionText(run.selection);
  return (
    <li className="run-card" data-state={run.state}>
      <div className="run-card-head">
        <strong>{runActionLabel[run.action] ?? run.action}</strong>
        <span className={stateClass(run)} title={run.errorCode ?? undefined}>
          {stateText(run)}
        </span>
      </div>
      {run.state === 'failed' && run.errorCode && (
        <p
          className={needsLocationDecision(run) ? 'run-error run-review-text' : 'run-error'}
          title={run.errorCode}
        >
          {errorText(run.errorCode)}
        </p>
      )}
      <RunLastLines run={run} />
      <p className="pane-meta">
        Step: {run.phase} · Attempt {run.attempt}
        {summary ? ` · ${summary}` : ''}
      </p>
      <p className="pane-meta">
        {run.startedAt
          ? `Started ${formatDateTime(run.startedAt)}`
          : `Queued ${formatDateTime(run.createdAt)}`}
        {run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ''}
      </p>
      <button className="quiet-button" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
        {logOpen ? 'Hide log' : 'Log'}
      </button>
      {run.action === 'publish' && run.state === 'completed' && run.jobId && (
        <p>
          <a href={letterPdfHref(run.jobId)} target="_blank" rel="noopener noreferrer">
            Open the PDF (draft, new tab)
          </a>
        </p>
      )}
      {logOpen && <RunLogView runId={run.id} active={isActiveRun(run)} />}
    </li>
  );
}
