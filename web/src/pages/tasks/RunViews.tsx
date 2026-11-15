import { useEffect, useRef, useState } from 'react';
import type { ScanReport } from '../../api';
import { api } from '../../lib/client';
import { summaryLabels } from '../../lib/runs';

export function RunLogFollow({ runId, active }: { runId: string; active: boolean }) {
  const [text, setText] = useState('');
  const [paused, setPaused] = useState(false);
  const [lagging, setLagging] = useState(false);
  const offsetRef = useRef(0);
  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    offsetRef.current = 0;
    setText('');
    setPaused(false);
  }, [runId]);
  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const pull = async () => {
      try {
        const result = await api.runLog(runId, offsetRef.current, controller.signal);
        if (cancelled) return;
        offsetRef.current = result.data.nextOffset;
        setLagging(false);
        if (result.data.text) setText(previous => (previous + result.data.text).slice(-20000));
      } catch {
        if (!cancelled) setLagging(true);
      }
      if (!cancelled && active) timer = window.setTimeout(pull, 2000);
    };
    void pull();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [runId, active, paused]);
  useEffect(() => {
    const pre = preRef.current;
    if (pre && !paused) pre.scrollTop = pre.scrollHeight;
  }, [text, paused]);
  return (
    <div className="log-follow">
      <div className="log-follow-head">
        <strong>Log</strong>
        {active && (
          <button className="quiet-button" onClick={() => setPaused(value => !value)}>
            {paused ? 'Continue following' : 'Pause'}
          </button>
        )}
        {paused && <span className="pane-meta">Paused. The log is not being read.</span>}
        {lagging && !paused && (
          <span className="pane-meta" role="status">
            {active ? 'Reconnecting...' : 'The log could not be read.'}
          </span>
        )}
      </div>
      <pre ref={preRef} className="doc-text log-tail" tabIndex={0} aria-label="Run log tail">
        {text || 'The log is empty so far.'}
      </pre>
    </div>
  );
}

export function ScanReportSummary({ runId }: { runId: string }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok'; value: ScanReport } | { kind: 'error' }
  >({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    api.scanReport(runId, controller.signal).then(
      result => {
        if (!controller.signal.aborted) setState({ kind: 'ok', value: result.data });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [runId]);
  if (state.kind === 'loading') return <p className="pane-meta">Reading the scan report...</p>;
  if (state.kind === 'error')
    return <p className="missing-copy">The scan finished but its report could not be read.</p>;
  return (
    <div className="scan-report">
      <h4>Scan report{state.value.dryRun ? ' (dry run, nothing saved)' : ''}</h4>
      <dl className="report-summary">
        {summaryLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{state.value.summary[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
