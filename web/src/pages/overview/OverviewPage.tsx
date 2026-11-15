import { useEffect, useState } from 'react';
import { ApiFailure, type EndpointState } from '../../api';
import type { OverviewResponse } from '../../generated/api';
import { api } from '../../lib/client';
import { formatPercent } from '../../lib/format';
import { bucketFilters, listHref } from '../../lib/jobsLocation';

export function OverviewPage({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<EndpointState<OverviewResponse>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // A refresh after a finished run keeps the numbers on screen until the new ones arrive.
    setState(previous => (previous.kind === 'success' ? previous : { kind: 'loading' }));
    void api.overview(controller.signal).then(
      value => {
        if (!controller.signal.aborted) setState({ kind: 'success', value });
      },
      error => {
        if (!controller.signal.aborted)
          setState({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => controller.abort();
  }, [retry, refreshKey]);
  if (state.kind === 'loading')
    return (
      <section className="empty-state" role="status">
        <span className="spinner" aria-hidden="true" /> Loading overview…
      </section>
    );
  if (state.kind === 'error')
    return (
      <div className="notice notice-error" role="alert">
        <div>
          <strong>Overview could not be loaded.</strong>
          <p>{state.error.message}</p>
        </div>
        <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
          Retry overview
        </button>
      </div>
    );
  const { metrics, progress } = state.value.data;
  return (
    <div className="overview-content">
      <p className="inferred-label">
        Pipeline metrics inferred from current job statuses and notes
      </p>
      <section className="metric-grid" aria-label="Pipeline metrics">
        <article className="metric-card">
          <span>Jobs in pipeline</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="metric-card">
          <span>Actionable</span>
          <strong>{metrics.actionable}</strong>
        </article>
        <article className="metric-card">
          <span>Average score</span>
          <strong>{metrics.avgScore === null ? '—' : metrics.avgScore.toFixed(2)}</strong>
        </article>
        <article className="metric-card">
          <span>Top score</span>
          <strong>{metrics.topScore === null ? '—' : metrics.topScore.toFixed(1)}</strong>
        </article>
      </section>
      <section className="overview-grid">
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Pipeline</h2>
              <p>Current status counts and progress</p>
            </div>
          </div>
          <div className="status-counts">
            {Object.entries(metrics.byStatus).map(([status, count]) => (
              <div key={status}>
                <span>{status}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Progress funnel</h2>
              <p>Rates use the existing pipeline formulas</p>
            </div>
          </div>
          <div className="funnel-list">
            {progress.funnel.map(step => (
              <div className="funnel-row" key={step.label}>
                <div>
                  <strong>{step.label}</strong>
                  <span>
                    {step.count} · {formatPercent(step.percent)}
                  </span>
                </div>
                <progress
                  max="100"
                  value={step.percent}
                  aria-label={`${step.label}: ${step.count}, ${formatPercent(step.percent)}`}
                />
              </div>
            ))}
          </div>
          <div className="rate-row">
            <span>
              Response rate <strong>{formatPercent(progress.responseRate)}</strong>
            </span>
            <span>
              Interview rate <strong>{formatPercent(progress.interviewRate)}</strong>
            </span>
            <span>
              Offer rate <strong>{formatPercent(progress.offerRate)}</strong>
            </span>
          </div>
        </article>
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Score distribution</h2>
              <p>Includes any retained score</p>
            </div>
          </div>
          <div className="bucket-list">
            {progress.scoreBuckets.map(bucket => {
              const key = bucket.label.trim();
              const range = bucketFilters[key];
              const content = (
                <>
                  <span>{key}</span>
                  <strong>{bucket.count}</strong>
                </>
              );
              if (!range) return <div key={bucket.label}>{content}</div>;
              const params: Record<string, string> = {};
              if (range.scoreMin !== undefined) params.scoreMin = String(range.scoreMin);
              if (range.scoreMax !== undefined) params.scoreMax = String(range.scoreMax);
              return (
                <a
                  key={bucket.label}
                  className="overview-link"
                  href={listHref(params)}
                  aria-label={`Show ${bucket.count} jobs with score ${key}`}
                >
                  {content}
                </a>
              );
            })}
          </div>
        </article>
        <article className="panel-card">
          <div className="section-heading">
            <div>
              <h2>Added by week</h2>
              <p>Last eight available ISO weeks</p>
            </div>
          </div>
          {progress.weeklyActivity.length ? (
            <div className="weekly-list">
              {progress.weeklyActivity.map(week => (
                <a
                  key={week.week}
                  className="overview-link"
                  href={listHref({ addedWeek: week.week })}
                  aria-label={`Show ${week.count} jobs added in ${week.week}`}
                >
                  <span>{week.week}</span>
                  <strong>{week.count}</strong>
                </a>
              ))}
            </div>
          ) : (
            <p className="subtle-copy">No dated jobs are available for weekly activity.</p>
          )}
        </article>
      </section>
    </div>
  );
}
