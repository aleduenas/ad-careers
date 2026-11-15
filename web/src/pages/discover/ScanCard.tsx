import { useEffect, useState } from 'react';
import { ApiFailure, type RunRecord, type ScanReport } from '../../api';
import { api } from '../../lib/client';
import { formatDateTime } from '../../lib/format';
import { errorText, summaryLabels } from '../../lib/runs';
import { activeRunId } from '../../lib/errors';

export function ScanCard({ nonce }: { nonce: string }) {
  const [company, setCompany] = useState('');
  const [run, setRun] = useState<RunRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [report, setReport] = useState<
    { kind: 'none' } | { kind: 'loading' } | { kind: 'ok'; value: ScanReport } | { kind: 'error' }
  >({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<{ text: string; offset: number }>({ text: '', offset: 0 });
  const active = run !== null && (run.state === 'queued' || run.state === 'running');

  // Find the most recent scan run on first load.
  useEffect(() => {
    const controller = new AbortController();
    api.runs(controller.signal).then(
      result => {
        if (controller.signal.aborted) return;
        const scans = result.data.runs
          .filter(item => item.action === 'scan')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (scans[0]) setRun(scans[0]);
        setLoaded(true);
      },
      () => {
        if (!controller.signal.aborted) setLoaded(true);
      },
    );
    return () => controller.abort();
  }, []);

  // Poll the run while it is queued or running.
  useEffect(() => {
    if (!run || !active) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      api.run(run.id, controller.signal).then(
        result => {
          if (!controller.signal.aborted) setRun(result.data.run);
        },
        () => undefined,
      );
    }, 2000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [run?.id, active]);

  // Read the report once a run completes.
  useEffect(() => {
    if (!run || run.state !== 'completed') {
      setReport({ kind: 'none' });
      return;
    }
    const controller = new AbortController();
    setReport({ kind: 'loading' });
    api.scanReport(run.id, controller.signal).then(
      result => {
        if (!controller.signal.aborted) setReport({ kind: 'ok', value: result.data });
      },
      () => {
        if (!controller.signal.aborted) setReport({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [run?.id, run?.state]);

  // Tail the log while it is open (and keep following a running scan).
  useEffect(() => {
    if (!run || !logOpen) return;
    const controller = new AbortController();
    let offset = 0;
    let cancelled = false;
    setLog({ text: '', offset: 0 });
    const pull = () => {
      api.runLog(run.id, offset, controller.signal).then(
        result => {
          if (cancelled) return;
          offset = result.data.nextOffset;
          setLog(previous => ({
            text: (previous.text + result.data.text).slice(-20000),
            offset,
          }));
        },
        () => undefined,
      );
    };
    pull();
    const timer = active ? window.setInterval(pull, 2000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      controller.abort();
    };
  }, [run?.id, logOpen, active]);

  const start = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    setBusyNote(null);
    try {
      const result = await api.startScan(
        {
          action: 'scan',
          requestKey: `scan-${crypto.randomUUID()}`,
          dryRun: dry,
          ...(company.trim() ? { company: company.trim() } : {}),
        },
        nonce,
        new AbortController().signal,
      );
      setDryRun(dry);
      setRun(result.data.runs[0]);
      setLog({ text: '', offset: 0 });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'DISCOVERY_BUSY') {
        const id = activeRunId(failure);
        setBusyNote(
          id
            ? `A scan or intake is already running (run ${id}). Showing it below.`
            : 'A scan or intake is already running. Try again when it finishes.',
        );
        if (id) {
          try {
            const existing = await api.run(id, new AbortController().signal);
            setRun(existing.data.run);
          } catch {
            /* the note above is enough */
          }
        }
      } else if (failure instanceof ApiFailure && failure.code === 'LOCAL_REQUEST_REJECTED') {
        setError('The local session is no longer valid. Reload the page and try again.');
      } else {
        setError(
          failure instanceof ApiFailure ? failure.message : 'The scan could not be started.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const reportValue = report.kind === 'ok' ? report.value : null;
  const summary = reportValue ? reportValue.summary : null;
  const missing = report.kind === 'ok' ? report.value.missing : [];
  return (
    <section className="edit-card discover-card" aria-labelledby="scan-title">
      <h3 id="scan-title">Scan portals</h3>
      <p className="pane-meta">
        A dry run shows what a scan would find without saving anything. A real scan adds new
        postings and runs in the background.
      </p>
      <label className="scan-filter">
        Company filter (optional)
        <input
          type="text"
          value={company}
          disabled={busy || active}
          placeholder="Leave empty to scan everything"
          maxLength={100}
          onChange={event => setCompany(event.target.value)}
        />
      </label>
      <div className="edit-actions">
        <button className="quiet-button" disabled={busy || active} onClick={() => void start(true)}>
          Dry-run scan
        </button>
        <button
          className="primary-button"
          disabled={busy || active}
          onClick={() => void start(false)}
        >
          Run scan
        </button>
      </div>
      {busyNote && (
        <div className="notice notice-warn" role="alert">
          <p>{busyNote}</p>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {!loaded && (
        <p className="pane-meta" role="status">
          Looking for the last scan…
        </p>
      )}
      {loaded && !run && <p className="missing-copy">No scan has been run yet.</p>}
      {run && (
        <div className="run-state" role="status" aria-live="polite">
          <p>
            <strong>
              {run.state === 'queued' && 'Scan queued'}
              {run.state === 'running' && 'Scan running'}
              {run.state === 'completed' && 'Scan finished'}
              {run.state === 'failed' && 'Scan failed'}
              {run.state === 'interrupted' && 'Scan interrupted'}
            </strong>
            {(dryRun === true || reportValue?.dryRun === true) && ' (dry run)'}
            {` · step: ${run.phase}`}
            {run.errorCode ? ` · ${errorText(run.errorCode)}` : ''}
          </p>
          <p className="pane-meta">
            Started {formatDateTime(run.startedAt ?? run.createdAt)}
            {run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ''}
          </p>
          <button
            className="quiet-button"
            aria-expanded={logOpen}
            onClick={() => setLogOpen(!logOpen)}
          >
            {logOpen ? 'Hide log tail' : 'Show log tail'}
          </button>
          {logOpen && (
            <pre className="doc-text log-tail" tabIndex={0} aria-label="Scan log tail">
              {log.text || 'The log is empty so far.'}
            </pre>
          )}
        </div>
      )}
      {report.kind === 'loading' && (
        <p className="pane-meta" role="status">
          Reading the scan report…
        </p>
      )}
      {report.kind === 'error' && run?.state === 'completed' && (
        <p className="missing-copy">The scan finished but its report could not be read.</p>
      )}
      {summary && (
        <div className="scan-report">
          <h4>Last scan summary</h4>
          <dl className="report-summary">
            {summaryLabels.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{summary[key]}</dd>
              </div>
            ))}
          </dl>
          {reportValue && (
            <p className="pane-meta">
              {reportValue.dryRun ? 'Dry run: nothing was saved. ' : 'Real scan. '}Generated{' '}
              {formatDateTime(reportValue.generatedAt)}.
            </p>
          )}
          {reportValue && reportValue.companies.length > 0 && (
            <details>
              <summary>Per-company results ({reportValue.companies.length})</summary>
              <div
                className="table-scroll"
                role="region"
                aria-label="Per-company scan results"
                tabIndex={0}
              >
                <table className="history-table">
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col">Status</th>
                      <th scope="col">Provider</th>
                      <th scope="col">Jobs</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportValue.companies.map((row, index) => (
                      <tr key={`${row.company}-${index}`}>
                        <td>{row.company}</td>
                        <td>{row.status}</td>
                        <td>{row.provider ?? '—'}</td>
                        <td>{row.jobsFound}</td>
                        <td>{row.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <h4>Missing full JD</h4>
          {missing.length === 0 ? (
            <p className="missing-copy">Nothing was deferred for a missing full description.</p>
          ) : (
            <>
              <p className="pane-meta">
                These postings were not saved because no full job description could be found.
              </p>
              <ul className="file-list">
                {missing.map((item, index) => (
                  <li key={`${item.url}-${index}`}>
                    <div>
                      <strong>{item.company || 'Company missing'}</strong>
                      <span>{item.title || 'Title missing'}</span>
                    </div>
                    {/^https?:\/\//i.test(item.url) && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        Posting
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
