import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiFailure,
  type CostCall,
  type CostRange,
  type CostJobRow,
  type CostSummary,
  type CostTotals,
  type createApi,
} from '../../api';

type Api = ReturnType<typeof createApi>;
type Mode = 'tokens' | 'price';
type State<T> =
  { kind: 'loading' } | { kind: 'ok'; value: T } | { kind: 'error'; error: ApiFailure };

const ranges: { id: CostRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
];
const RECENT_LIMIT = 50;
const MODE_KEY = 'career-ops-cost-mode';
const ESTIMATES_KEY = 'career-ops-cost-estimates';

const whole = new Intl.NumberFormat(undefined);
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const exact = (value: number) => whole.format(value);
const short = (value: number) => (value < 10_000 ? whole.format(value) : compact.format(value));
function usd(value: number | null): string {
  if (value === null) return 'n/a';
  // Cents for dollars, three decimals below a dollar, four below a cent, so small calls never read as $0.00.
  const digits = value === 0 || value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function readRange(): CostRange {
  const value = new URLSearchParams(location.search).get('range');
  return value === '7d' || value === '30d' || value === '90d' || value === 'all' ? value : '30d';
}

function readEstimates(): boolean {
  try {
    return localStorage.getItem(ESTIMATES_KEY) !== 'off';
  } catch {
    return true;
  }
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'price' ? 'price' : 'tokens';
  } catch {
    return 'tokens';
  }
}

function useRange(): [CostRange, (next: CostRange) => void] {
  const [range, setRange] = useState<CostRange>(readRange);
  // The range lives in the URL only while the Cost page is open.
  useEffect(
    () => () => {
      const params = new URLSearchParams(location.search);
      if (!params.has('range')) return;
      params.delete('range');
      const search = params.toString();
      history.replaceState(
        null,
        '',
        `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
      );
    },
    [],
  );
  useEffect(() => {
    const onNav = () => setRange(readRange());
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  }, []);
  return [
    range,
    next => {
      const params = new URLSearchParams(location.search);
      params.set('range', next);
      history.pushState(null, '', `?${params.toString()}${location.hash}`);
      setRange(next);
    },
  ];
}

/** The figure a row shows in the chosen mode. */
function figure(
  row: { totalTokens: number; estimatedUsd: number | null },
  mode: Mode,
): number | null {
  return mode === 'tokens' ? row.totalTokens : row.estimatedUsd;
}

type Priced = { estimatedUsd: number | null; unpricedCalls?: number; estimatedCalls?: number };

/** A small "est." mark for an amount or count that includes estimated calls. */
function Est({ row }: { row: { estimatedCalls?: number } }) {
  const n = row.estimatedCalls ?? 0;
  if (n <= 0) return null;
  const note = `${exact(n)} estimated ${n === 1 ? 'call' : 'calls'}`;
  return (
    <span className="cost-est" role="img" aria-label={note} title={note}>
      est.
    </span>
  );
}

/** The USD text; a sum that leaves some calls unpriced is a lower bound and ends in "+". */
function usdText(row: Priced): string {
  const text = usd(row.estimatedUsd);
  return row.estimatedUsd !== null && (row.unpricedCalls ?? 0) > 0 ? `${text}+` : text;
}

function unpricedNote(row: Priced): string | undefined {
  const n = row.unpricedCalls ?? 0;
  return row.estimatedUsd !== null && n > 0
    ? `${exact(n)} ${n === 1 ? 'call' : 'calls'} not priced`
    : undefined;
}

function UsdFigure({ row }: { row: Priced }) {
  const note = unpricedNote(row);
  return (
    <span title={note} aria-label={note ? `${usd(row.estimatedUsd)} or more, ${note}` : undefined}>
      {usdText(row)}
      <Est row={row} />
    </span>
  );
}

function Figure({ row, mode }: { row: { totalTokens: number } & Priced; mode: Mode }) {
  return mode === 'tokens' ? (
    <span title={exact(row.totalTokens)}>
      {exact(row.totalTokens)}
      <Est row={row} />
    </span>
  ) : (
    <UsdFigure row={row} />
  );
}

function TokenCells({ row }: { row: CostTotals }) {
  return (
    <>
      <td className="num">{exact(row.inputTokens)}</td>
      <td className="num">{exact(row.cachedInputTokens)}</td>
      <td className="num">{exact(row.cacheWriteTokens)}</td>
      <td className="num">{exact(row.outputTokens)}</td>
      <td className="num">{exact(row.reasoningTokens)}</td>
      <td className="num">
        {exact(row.totalTokens)}
        <Est row={row} />
      </td>
    </>
  );
}

function BreakdownTable({
  title,
  id,
  first,
  rows: allRows,
  mode,
  initialRows,
  noun,
}: {
  title: string;
  id: string;
  first: string;
  rows: { key: string; label: React.ReactNode; row: CostTotals }[];
  mode: Mode;
  /** Show only this many rows until the owner asks for all of them. */
  initialRows?: number;
  noun?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows =
    initialRows && !expanded && allRows.length > initialRows
      ? allRows.slice(0, initialRows)
      : allRows;
  return (
    <section className="cost-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="table-scroll" role="region" aria-label={`${title} table`} tabIndex={0}>
        <table className="cost-table">
          <thead>
            <tr>
              <th scope="col">{first}</th>
              <th scope="col" className="num">
                Calls
              </th>
              {mode === 'tokens' ? (
                <>
                  <th scope="col" className="num">
                    Input
                  </th>
                  <th scope="col" className="num">
                    Cached input
                  </th>
                  <th scope="col" className="num">
                    Cache write
                  </th>
                  <th scope="col" className="num">
                    Output
                  </th>
                  <th scope="col" className="num">
                    Reasoning
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </>
              ) : (
                <th scope="col" className="num">
                  Estimated USD
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(item => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td className="num">
                  {exact(item.row.calls)}
                  <Est row={item.row} />
                </td>
                {mode === 'tokens' ? (
                  <TokenCells row={item.row} />
                ) : (
                  <td className="num">
                    <UsdFigure row={item.row} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {initialRows !== undefined && allRows.length > initialRows && (
        <div className="edit-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={() => setExpanded(value => !value)}
          >
            {expanded
              ? `Show the top ${initialRows} ${noun ?? 'rows'}`
              : `Show all ${allRows.length} ${noun ?? 'rows'}`}
          </button>
        </div>
      )}
    </section>
  );
}

/** One entry per calendar day from the range start (or the first day with calls) to today. */
function fillDays(
  rows: CostSummary['byDay'],
  since: string | null,
  until: string,
): CostSummary['byDay'] {
  if (rows.length === 0) return rows;
  const byDay = new Map(rows.map(row => [row.day, row]));
  const first = since ? since.slice(0, 10) : [...byDay.keys()].sort()[0];
  const last = [until.slice(0, 10), ...byDay.keys()].sort().at(-1) as string;
  const out: CostSummary['byDay'] = [];
  const cursor = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return rows;
  for (let guard = 0; cursor <= end && guard < 1500; guard += 1) {
    const day = cursor.toISOString().slice(0, 10);
    out.push(
      byDay.get(day) ?? {
        day,
        calls: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        estimatedUsd: 0,
      },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function DayBars({
  days: rows,
  since,
  until,
  mode,
}: {
  days: CostSummary['byDay'];
  since: string | null;
  until: string;
  mode: Mode;
}) {
  const days = useMemo(() => fillDays(rows, since, until), [rows, since, until]);
  const scroller = useRef<HTMLDivElement | null>(null);
  // The chart is one tab stop: arrow keys move between bars, Home and End jump to the ends.
  const [active, setActive] = useState(-1);
  const current = active >= 0 && active < days.length ? active : days.length - 1;
  const moveTo = (index: number) => {
    const next = Math.min(days.length - 1, Math.max(0, index));
    setActive(next);
    scroller.current?.querySelectorAll<HTMLElement>('.cost-bar-slot')[next]?.focus();
  };
  // The newest days are the ones that matter, so a chart wider than its pane starts at the right.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [days]);
  const values = days.map(day => figure(day, mode) ?? 0);
  const peak = Math.max(...values, 0);
  const step = Math.max(1, Math.ceil(days.length / 10));
  const label = (day: CostSummary['byDay'][number]) =>
    `${day.day}: ${mode === 'tokens' ? `${exact(day.totalTokens)} tokens` : usdText(day)}, ${exact(day.calls)} ${day.calls === 1 ? 'call' : 'calls'}${(day.estimatedCalls ?? 0) > 0 ? `, ${exact(day.estimatedCalls ?? 0)} estimated` : ''}`;
  return (
    <section className="cost-section" aria-labelledby="cost-days-title">
      <h2 id="cost-days-title">Per day</h2>
      <div className="cost-days-scroll" ref={scroller}>
        <ul
          className="cost-days"
          aria-label="Per day chart"
          style={{ '--days': days.length } as React.CSSProperties}
        >
          {days.map((day, index) => (
            <li key={day.day}>
              <div
                className="cost-bar-slot"
                role="img"
                aria-label={label(day)}
                tabIndex={index === current ? 0 : -1}
                onFocus={() => setActive(index)}
                onKeyDown={event => {
                  const keys: Record<string, number> = {
                    ArrowLeft: current - 1,
                    ArrowRight: current + 1,
                    Home: 0,
                    End: days.length - 1,
                  };
                  if (event.key in keys) {
                    event.preventDefault();
                    moveTo(keys[event.key]);
                  }
                }}
                title={label(day)}
                style={
                  {
                    '--bar': peak > 0 ? `${(values[index] / peak) * 100}%` : '0%',
                  } as React.CSSProperties
                }
              >
                <span className="cost-bar" />
                <span className="cost-bar-value">{label(day)}</span>
              </div>
              <span className="cost-day-label">{index % step === 0 ? day.day.slice(5) : ''}</span>
            </li>
          ))}
        </ul>
      </div>
      <details className="cost-days-table">
        <summary>Show the per day figures as a table</summary>
        <div className="table-scroll" role="region" aria-label="Per day figures table" tabIndex={0}>
          <table className="cost-table">
            <caption className="visually-hidden">Calls and usage for each day in the range</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="num">
                  Calls
                </th>
                <th scope="col" className="num">
                  {mode === 'tokens' ? 'Total tokens' : 'Estimated USD'}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => (
                <tr key={day.day}>
                  <th scope="row">{day.day}</th>
                  <td className="num">{exact(day.calls)}</td>
                  <td className="num">
                    <Figure row={day} mode={mode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Card({
  label,
  value,
  title,
  row,
}: {
  label: string;
  value: string;
  title?: string;
  row?: { estimatedCalls?: number };
}) {
  return (
    <article className="cost-card">
      <span>{label}</span>
      <strong title={title}>
        {value}
        {row && <Est row={row} />}
      </strong>
    </article>
  );
}

export function CostPage({ api }: { api: Api }) {
  const [range, setRange] = useRange();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [summary, setSummary] = useState<State<CostSummary>>({ kind: 'loading' });
  const [calls, setCalls] = useState<State<{ calls: CostCall[]; total: number }>>({
    kind: 'loading',
  });
  const [retry, setRetry] = useState(0);
  const [estimates, setEstimatesState] = useState(readEstimates);

  const setEstimates = (next: boolean) => {
    setEstimatesState(next);
    try {
      localStorage.setItem(ESTIMATES_KEY, next ? 'on' : 'off');
    } catch {
      // The choice only lasts for this visit when storage is unavailable.
    }
  };

  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // The choice only lasts for this visit when storage is unavailable.
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setSummary({ kind: 'loading' });
    setCalls({ kind: 'loading' });
    const fail = (error: unknown): { kind: 'error'; error: ApiFailure } => ({
      kind: 'error',
      error:
        error instanceof ApiFailure
          ? error
          : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
    });
    api.costSummary(range, estimates, controller.signal).then(
      value => {
        if (!controller.signal.aborted) setSummary({ kind: 'ok', value: value.data });
      },
      error => {
        if (!controller.signal.aborted) setSummary(fail(error));
      },
    );
    api.costCalls(range, RECENT_LIMIT, estimates, controller.signal).then(
      value => {
        if (!controller.signal.aborted)
          setCalls({ kind: 'ok', value: { calls: value.data.calls, total: value.data.total } });
      },
      error => {
        if (!controller.signal.aborted) setCalls(fail(error));
      },
    );
    return () => controller.abort();
  }, [range, estimates, retry]);

  const jobNames = useMemo(() => {
    const map = new Map<string, string>();
    if (summary.kind === 'ok')
      for (const job of summary.value.byJob)
        if (job.jobId) map.set(job.jobId, [job.company, job.role].filter(Boolean).join(' - '));
    return map;
  }, [summary]);

  const controls = (
    <div className="cost-bar-controls">
      <div className="filter-chips" role="group" aria-label="Date range">
        {ranges.map(item => (
          <button
            key={item.id}
            type="button"
            className="quiet-button"
            aria-pressed={range === item.id}
            onClick={() => setRange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="cost-toggle" role="group" aria-label="Show figures as">
        {(
          [
            ['tokens', 'Tokens'],
            ['price', 'API price'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="quiet-button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
        <label className="cost-switch">
          <input
            type="checkbox"
            checked={estimates}
            onChange={event => setEstimates(event.target.checked)}
          />
          Include estimates
        </label>
      </div>
    </div>
  );

  if (summary.kind === 'loading')
    return (
      <div className="cost-page">
        {controls}
        <section className="empty-state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading usage…
        </section>
      </div>
    );
  if (summary.kind === 'error') {
    const unavailable = ['DATABASE_UNAVAILABLE', 'SCHEMA_NOT_READY'].includes(summary.error.code);
    return (
      <div className="cost-page">
        {controls}
        <div className={`notice ${unavailable ? 'notice-warn' : 'notice-error'}`} role="alert">
          <div>
            <strong>Usage could not be loaded.</strong>
            <p>{summary.error.message}</p>
          </div>
          <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const data = summary.value;
  const totals = data.totals;
  const jobLabel = (job: CostJobRow) =>
    job.jobId ? (
      <a className="in-page-link" href={`#/jobs/${job.jobId}`}>
        <strong>{job.company || 'Company missing'}</strong>
        <span className="cost-sub">{job.role || 'Role missing'}</span>
      </a>
    ) : (
      'No job (scan, intake)'
    );

  return (
    <div className="cost-page">
      {controls}
      {mode === 'price' && (
        <p className="pane-meta cost-note">
          Subscription plan; this is what the same calls would cost at public API prices.
          {data.unpriced.length > 0 && ` Unpriced models: ${data.unpriced.join(', ')}.`}
        </p>
      )}
      {estimates && (totals.estimatedCalls ?? 0) > 0 && (
        <p className="pane-meta cost-note">
          Drafting before Nov 12, 2026 was not logged; those calls are estimated from saved prompt
          and response sizes and call durations.
        </p>
      )}
      {totals.calls === 0 ? (
        <section className="empty-state" role="status">
          <h2>No model calls in this range</h2>
          <p>
            Calls are recorded when evaluation, drafting and intake run. Pick a longer range, or run
            one of those from the Jobs page.
          </p>
        </section>
      ) : (
        <>
          <section className="cost-cards" aria-label="Totals">
            <Card label="Calls" value={exact(totals.calls)} row={totals} />
            {mode === 'tokens' ? (
              <>
                {(
                  [
                    ['Input tokens', totals.inputTokens],
                    ['Cached input tokens', totals.cachedInputTokens],
                    ['Cache write tokens', totals.cacheWriteTokens],
                    ['Output tokens', totals.outputTokens],
                    ['Reasoning tokens', totals.reasoningTokens],
                    ['Total tokens', totals.totalTokens],
                  ] as const
                ).map(([label, value]) => (
                  <Card
                    key={label}
                    label={label}
                    value={short(value)}
                    title={exact(value)}
                    row={totals}
                  />
                ))}
              </>
            ) : (
              <Card
                label="Estimated cost at API prices"
                value={usdText(totals)}
                row={totals}
                title={
                  totals.estimatedUsd === null
                    ? 'No priced calls in this range'
                    : unpricedNote(totals)
                }
              />
            )}
          </section>
          {mode === 'tokens' && (
            <p className="pane-meta cost-note">
              Reasoning tokens are counted inside output tokens and shown separately for reference.
            </p>
          )}

          <DayBars days={data.byDay} since={data.since} until={data.until} mode={mode} />
          <BreakdownTable
            title="Per model"
            id="cost-models-title"
            first="Model"
            mode={mode}
            rows={data.byModel.map(row => ({
              key: `${row.provider}/${row.model}`,
              label: <span className="cost-nowrap">{`${row.provider} / ${row.model}`}</span>,
              row,
            }))}
          />
          <BreakdownTable
            title="Per function"
            id="cost-functions-title"
            first="Function"
            mode={mode}
            rows={data.byFunction.map(row => ({ key: row.function, label: row.function, row }))}
          />
          <BreakdownTable
            title="Per job"
            id="cost-jobs-title"
            first="Job"
            mode={mode}
            initialRows={15}
            noun="jobs"
            rows={data.byJob.map(row => ({
              key: row.jobId ?? 'none',
              label: jobLabel(row),
              row,
            }))}
          />

          <section className="cost-section" aria-labelledby="cost-calls-title">
            <h2 id="cost-calls-title">Recent calls</h2>
            {calls.kind === 'loading' && (
              <p className="pane-meta" role="status">
                Loading recent calls…
              </p>
            )}
            {calls.kind === 'error' && (
              <div className="notice notice-error" role="alert">
                <div>
                  <strong>Recent calls could not be loaded.</strong>
                  <p>{calls.error.message}</p>
                </div>
                <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
                  Retry
                </button>
              </div>
            )}
            {calls.kind === 'ok' && (
              <>
                <p className="pane-meta">
                  Showing the latest {exact(calls.value.calls.length)} of {exact(calls.value.total)}
                  .
                </p>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Recent calls table"
                  tabIndex={0}
                >
                  <table className="cost-table">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Function</th>
                        <th scope="col">Model</th>
                        <th scope="col">Job</th>
                        <th scope="col" className="num">
                          {mode === 'tokens' ? 'Tokens' : 'Estimated USD'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {calls.value.calls.map(call => (
                        <tr key={call.id}>
                          <th scope="row">
                            <time dateTime={call.occurredAt}>
                              {new Date(call.occurredAt).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </time>
                            {call.source === 'backfill' && (
                              <span className="cost-sub">from logs</span>
                            )}
                            {call.source === 'estimate' && (
                              <span className="cost-sub">estimated</span>
                            )}
                          </th>
                          <td>{call.function}</td>
                          <td>
                            {call.provider} / {call.model}
                          </td>
                          <td>
                            {call.jobId ? (
                              <a className="in-page-link" href={`#/jobs/${call.jobId}`}>
                                {jobNames.get(call.jobId) || `Job ${call.jobId}`}
                              </a>
                            ) : (
                              'No job'
                            )}
                          </td>
                          <td className="num">
                            <Figure
                              row={{ ...call, estimatedCalls: call.source === 'estimate' ? 1 : 0 }}
                              mode={mode}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
