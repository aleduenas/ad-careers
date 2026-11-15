import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type EndpointState, type DetailJob } from '../../api';
import type { JobsQuery, JobsResponse } from '../../generated/api';
import { api } from '../../lib/client';
import { useJobsLocation, statusChips, scoreFilterLabel } from '../../lib/jobsLocation';
import { formatDate, formatSalary, compensationText, scoreText } from '../../lib/format';
import { startEvaluation, QuickMoves } from '../../components/QuickMoves';
import { FavoriteToggle } from '../../components/FavoriteToggle';
import { SlidePanel } from '../../components/SlidePanel';
import { visibleDiscardReason } from '../../lib/discard';
import { yoeConfidenceText, yoeIsUncertain, yoeLabel } from '../../lib/yoe';
import { postingIsClosed, postingStateText } from '../../lib/posting';
import { PasteForm } from '../discover/PasteForm';
import { BatchBar, canDiscardRow, canEvaluateRow } from './BatchBar';

const SEARCH_PROBLEM_DELAY_MS = 500;

export function JobsPage({
  refreshKey,
  intake,
  writer,
  dispatch,
}: {
  refreshKey: number;
  /** Present when the server offers pasted-JD intake; Add job opens the form in a slide-out. */
  intake: { nonce: string } | null;
  /** Present when the server offers job writes; the quick status buttons follow it. */
  writer: { nonce: string } | null;
  /** Present when the server can start runs; Pending rows then offer Evaluate. */
  dispatch: { nonce: string } | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [addedTick, setAddedTick] = useState(0);
  const [locationState, updateLocation] = useJobsLocation();
  const { query, cursor } = locationState;
  const [request, setRequest] = useState<EndpointState<JobsResponse>>({ kind: 'loading' });
  const [cursorNotice, setCursorNotice] = useState(false);
  const [retry, setRetry] = useState(0);
  // The server's own words for a search expression it cannot read. Shown after a short pause so a
  // half-typed expression does not flash, kept until a request succeeds, and never a page failure.
  const [searchProblem, setSearchProblem] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  // Rows ticked for a batch evaluation. Per page: any change of page, filter, sort or search clears it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const viewKey = JSON.stringify([query, cursor]);
  useEffect(() => setSelected(new Set()), [viewKey]);
  const [busy, setBusy] = useState(false);
  const searchHistoryStarted = useRef(false);
  const sequence = useRef(0);
  const focusResults = useRef(false);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const summaryRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++sequence.current;
    let problemTimer = 0;
    // Keep the previous results mounted while a new page loads so focus is not lost.
    setBusy(true);
    setRequest(previous => (previous.kind === 'success' ? previous : { kind: 'loading' }));
    void api.jobs(query, cursor, controller.signal).then(
      value => {
        if (controller.signal.aborted || requestId !== sequence.current) return;
        setSearchProblem(null);
        setRequest({ kind: 'success', value });
        setBusy(false);
      },
      error => {
        if (controller.signal.aborted || requestId !== sequence.current) return;
        setBusy(false);
        if (error instanceof ApiFailure && error.code === 'INVALID_REQUEST' && error.fields?.q) {
          const text = error.fields.q;
          problemTimer = window.setTimeout(() => setSearchProblem(text), SEARCH_PROBLEM_DELAY_MS);
          return;
        }
        if (
          error instanceof ApiFailure &&
          error.code === 'INVALID_REQUEST' &&
          error.fields?.cursor &&
          cursor
        ) {
          setCursorNotice(true);
          updateLocation(query, null, 'replace');
          return;
        }
        setRequest({
          kind: 'error',
          error:
            error instanceof ApiFailure
              ? error
              : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
        });
      },
    );
    return () => {
      controller.abort();
      window.clearTimeout(problemTimer);
    };
  }, [
    query.q,
    query.filter,
    query.sort,
    query.direction,
    query.grouped,
    query.limit,
    query.scoreMin,
    query.scoreMax,
    query.addedWeek,
    query.favorite,
    query.yoeMax,
    query.yoeUnknown,
    query.posting,
    cursor,
    retry,
    // A finished run changes what the list shows; the view inputs and the cursor stay as they are.
    refreshKey,
    // A job added from this page appears in the list without a reload.
    addedTick,
  ]);

  // "/" jumps to the search box unless the user is already typing somewhere or a dialog is open.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // After a page turn the pressed button may have been disabled or replaced; move focus to
    // the results summary so keyboard users continue from the new page.
    if (focusResults.current && request.kind === 'success' && !busy) {
      focusResults.current = false;
      summaryRef.current?.focus();
    }
  }, [request, busy]);

  // A press outside the Add job slide-out closes it (same rule as the workspace slide-outs).
  useEffect(() => {
    if (!addOpen) return;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('.ws-panel, dialog, .jobs-add-button')) return;
      const interactive = event.target.closest(
        'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      );
      setAddOpen(false);
      if (!interactive) window.requestAnimationFrame(() => addButton.current?.focus());
    };
    // Escape closes it even when focus has moved off the form (for example after a submit).
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      setAddOpen(false);
      addButton.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);
  const applyMoved = (job: DetailJob) =>
    setRequest(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: {
              ...previous.value,
              data: {
                ...previous.value.data,
                items: previous.value.data.items.map(item =>
                  item.id === job.id
                    ? {
                        ...item,
                        status: job.status,
                        statusDate: job.statusDate,
                        revision: job.revision,
                        discardReason: job.discardReason,
                      }
                    : item,
                ),
              },
            },
          }
        : previous,
    );
  const applyFavorite = (id: string, favorite: boolean) =>
    setRequest(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: {
              ...previous.value,
              data: {
                ...previous.value.data,
                items: previous.value.data.items.map(item =>
                  item.id === id ? { ...item, favorite } : item,
                ),
              },
            },
          }
        : previous,
    );
  const changeQuery = (patch: Partial<JobsQuery>, mode: 'push' | 'replace' = 'push') => {
    updateLocation({ ...query, ...patch }, null, mode);
    setCursorNotice(false);
  };
  const activeFilter = [
    scoreFilterLabel(query.scoreMin, query.scoreMax),
    query.addedWeek ? `Added in ${query.addedWeek}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const response = request.kind === 'success' ? request.value.data : undefined;
  // A row that can no longer be evaluated or discarded (moved on) drops out of the selection.
  useEffect(() => {
    if (!response) return;
    const pendingIds = new Set(
      response.items
        .filter(item => canEvaluateRow(item, dispatch) || canDiscardRow(item, writer))
        .map(item => item.id),
    );
    setSelected(previous =>
      [...previous].every(id => pendingIds.has(id))
        ? previous
        : new Set([...previous].filter(id => pendingIds.has(id))),
    );
  }, [response]);
  const groupedItems = response?.items.reduce<Record<string, typeof response.items>>(
    (groups, item) => {
      (groups[item.status] ??= []).push(item);
      return groups;
    },
    {},
  );
  const groups = [
    'Interview',
    'Offer',
    'Applied',
    'Evaluated',
    'Ghosted',
    'Rejected',
    'Discarded',
    'Pending',
  ];

  const table = (items: NonNullable<typeof response>['items']) => (
    <div className="table-scroll" role="region" aria-label="Jobs results" tabIndex={0}>
      <table className="jobs-table">
        <caption className="visually-hidden">Jobs matching the current search and filters</caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Company and role</th>
            <th scope="col">Status</th>
            <th scope="col">Score</th>
            <th scope="col">Compensation</th>
            <th scope="col">Dates</th>
            <th scope="col" className="col-minor">
              Materials
            </th>
            <th scope="col" className="col-minor">
              Discard reason
            </th>
            {writer && <th scope="col">Move</th>}
          </tr>
        </thead>
        <tbody>
          {items.map(job => {
            const pending = job.status === 'Pending';
            const comp = compensationText(job);
            const salary = formatSalary(job.salary);
            return (
              <tr key={job.id}>
                <th scope="row" className="job-id">
                  {canEvaluateRow(job, dispatch) || canDiscardRow(job, writer) ? (
                    <label className="batch-pick">
                      <input
                        type="checkbox"
                        checked={selected.has(job.id)}
                        aria-label={`Select ${job.company || 'Company missing'} – ${job.role || 'Role missing'} to evaluate or discard`}
                        onChange={event =>
                          setSelected(previous => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(job.id);
                            else next.delete(job.id);
                            return next;
                          })
                        }
                      />
                      <span className="job-id-text">{job.id}</span>
                    </label>
                  ) : (
                    job.id
                  )}
                </th>
                <td className={writer ? 'job-name has-favorite' : 'job-name'}>
                  <a href={`${location.search}#/jobs/${job.id}`}>
                    <strong>{job.company || 'Company missing'}</strong>
                    <span>{job.role || 'Role missing'}</span>
                  </a>
                  {job.yoeMin !== null && (
                    <span
                      className="job-yoe"
                      title={`Years of experience asked for: ${yoeConfidenceText(job.yoeConfidence)}`}
                    >
                      {yoeLabel(job.yoeMin)}
                      {yoeIsUncertain(job.yoeConfidence) && (
                        <em className="job-yoe-mark"> ~ {yoeConfidenceText(job.yoeConfidence)}</em>
                      )}
                    </span>
                  )}
                  {writer && (
                    <FavoriteToggle
                      jobId={job.id}
                      label={`${job.company || 'Company missing'} – ${job.role || 'Role missing'}`}
                      favorite={job.favorite}
                      nonce={writer.nonce}
                      onApply={value => applyFavorite(job.id, value)}
                      onError={setMoveNotice}
                    />
                  )}
                  <span className="task-extra">
                    {[job.materials.cv ? 'CV' : null, job.materials.letter ? 'Letter' : null]
                      .filter(Boolean)
                      .join(' + ') || 'No verified materials'}
                    {job.status === 'Discarded'
                      ? ` · Discarded${visibleDiscardReason(job.discardReason) ? `: ${visibleDiscardReason(job.discardReason)}` : ''}`
                      : ''}
                  </span>
                </td>
                <td>
                  <span className={`job-status status-${job.status.toLowerCase()}`}>
                    {job.status}
                  </span>
                  {job.posting && postingIsClosed(job.posting) && (
                    <span
                      className="posting-mark"
                      title={`Latest posting check (${formatDate(job.posting.checkedAt.slice(0, 10))}): ${postingStateText[job.posting.state]}`}
                    >
                      {job.posting.state === 'closed' ? 'Closed' : 'Probably closed'}
                    </span>
                  )}
                </td>
                <td>{scoreText(job.score, pending)}</td>
                <td className="compensation-cell">
                  <span>{comp}</span>
                  {salary && <small>Manual range: {salary}</small>}
                </td>
                <td className="date-cell">
                  <span>Added: {formatDate(job.addedDate)}</span>
                  <span>Status: {formatDate(job.statusDate)}</span>
                </td>
                <td className="col-minor">
                  <div className="material-badges">
                    {job.materials.cv && <span className="material-badge">CV</span>}
                    {job.materials.letter && <span className="material-badge">Letter</span>}
                    {!job.materials.cv && !job.materials.letter && (
                      <span aria-label="No verified materials">—</span>
                    )}
                  </div>
                </td>
                <td className="col-minor">
                  {job.status === 'Discarded'
                    ? (visibleDiscardReason(job.discardReason) ?? '—')
                    : '—'}
                </td>
                {writer && (
                  <td className="move-cell">
                    <QuickMoves
                      job={job}
                      nonce={writer.nonce}
                      onMoved={applyMoved}
                      onConflict={() => setRetry(value => value + 1)}
                      onNotice={setMoveNotice}
                      fastDiscard
                      evaluate={
                        dispatch
                          ? {
                              disabledReason: null,
                              start: () => startEvaluation(job.id, dispatch.nonce),
                            }
                          : null
                      }
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <section className="jobs-toolbar" aria-label="Job list controls">
        <div className="jobs-toolbar-row">
          <h1 className="jobs-title">Jobs</h1>
          <div className="search-box">
            <label className="search-control">
              <span className="visually-hidden">Search jobs</span>
              <input
                maxLength={200}
                aria-invalid={searchProblem ? true : undefined}
                aria-describedby={
                  searchProblem ? 'search-problem' : hintOpen ? 'search-hint' : undefined
                }
                ref={searchInput}
                type="search"
                aria-keyshortcuts="/"
                value={query.q}
                placeholder="Search jobs"
                onBlur={() => {
                  searchHistoryStarted.current = false;
                }}
                onChange={event => {
                  const mode = searchHistoryStarted.current ? 'replace' : 'push';
                  searchHistoryStarted.current = true;
                  changeQuery({ q: event.target.value }, mode);
                }}
              />
            </label>
            <button
              type="button"
              className="search-hint-button"
              aria-expanded={hintOpen}
              aria-controls="search-hint"
              aria-label="Search tips"
              onClick={() => setHintOpen(value => !value)}
            >
              ?
            </button>
            {hintOpen && (
              <p className="search-hint" id="search-hint">
                Capital AND, OR, NOT, "quoted phrases" and (parentheses) work. Examples:{' '}
                <code>NOT "senior"</code>, <code>("security" AND "AI")</code>,{' '}
                <code>security NOT ai</code>
              </p>
            )}
            {searchProblem && (
              <p className="search-problem" id="search-problem" role="status">
                {searchProblem} Showing the previous results.
              </p>
            )}
          </div>
          <div className="jobs-controls" role="group" aria-label="Sort and grouping">
            <label className="compact-control">
              <span>Sort by</span>
              <select
                value={query.sort}
                onChange={event => {
                  const sort = event.target.value as JobsQuery['sort'];
                  changeQuery({
                    sort,
                    direction: sort === 'company' || sort === 'yoe' ? 'asc' : 'desc',
                  });
                }}
              >
                <option value="score">Score</option>
                <option value="statusDate">Status date</option>
                <option value="addedDate">Added date</option>
                <option value="company">Company</option>
                <option value="favorite">Favorites first</option>
                <option value="yoe">Years, lowest first</option>
              </select>
            </label>
            <label className="compact-control">
              <span>Direction</span>
              <select
                value={query.direction}
                onChange={event =>
                  changeQuery({ direction: event.target.value as JobsQuery['direction'] })
                }
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
            <label className="compact-control">
              <span>Rows per page</span>
              <select
                value={query.limit}
                onChange={event => changeQuery({ limit: Number(event.target.value) })}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <label className="compact-control checkbox-control">
              <input
                type="checkbox"
                checked={query.favorite === true}
                onChange={event =>
                  changeQuery({ favorite: event.target.checked ? true : undefined })
                }
              />{' '}
              <span>Favorites only</span>
            </label>
            <label className="compact-control checkbox-control">
              <input
                type="checkbox"
                checked={query.grouped}
                onChange={event => changeQuery({ grouped: event.target.checked })}
              />{' '}
              <span>Group by status</span>
            </label>
          </div>
          {intake && (
            <button
              type="button"
              ref={addButton}
              className="primary-button jobs-add-button"
              aria-expanded={addOpen}
              aria-controls="ws-panel-add"
              onClick={() => setAddOpen(value => !value)}
            >
              Add job
            </button>
          )}
        </div>
        <div className="status-chips" role="group" aria-label="Filter by status">
          {statusChips.map(chip => (
            <button
              key={chip.value}
              type="button"
              className="status-chip"
              aria-pressed={query.filter === chip.value}
              onClick={() => changeQuery({ filter: chip.value })}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="jobs-filter-row" role="group" aria-label="More filters">
          <label className="compact-control">
            <span>At most (years)</span>
            <input
              type="number"
              min={0}
              max={40}
              step={1}
              inputMode="numeric"
              value={query.yoeMax ?? ''}
              placeholder="Any"
              onChange={event => {
                const text = event.target.value.trim();
                const number = Number(text);
                if (text === '')
                  changeQuery({ yoeMax: undefined, yoeUnknown: undefined }, 'replace');
                else if (Number.isInteger(number) && number >= 0 && number <= 40)
                  changeQuery({ yoeMax: number }, 'replace');
              }}
            />
          </label>
          <label className="compact-control checkbox-control">
            <input
              type="checkbox"
              disabled={query.yoeMax === undefined}
              checked={query.yoeMax !== undefined && query.yoeUnknown === 'exclude'}
              onChange={event =>
                changeQuery({ yoeUnknown: event.target.checked ? 'exclude' : undefined })
              }
            />{' '}
            <span>Hide jobs with no estimate</span>
          </label>
          <label className="compact-control">
            <span>Posting check</span>
            <select
              value={query.posting ?? ''}
              onChange={event =>
                changeQuery({
                  posting: (event.target.value || undefined) as JobsQuery['posting'],
                })
              }
            >
              <option value="">Any</option>
              <option value="expired">Expired by the check</option>
              <option value="applied-closed">Applied, posting closed</option>
            </select>
          </label>
        </div>
      </section>
      {(dispatch || writer) && (
        <BatchBar
          dispatch={dispatch}
          writer={writer}
          items={response?.items ?? []}
          selected={selected}
          onSelectedChange={setSelected}
          onDiscarded={() => setRetry(value => value + 1)}
        />
      )}
      {intake && (
        <SlidePanel
          id="ws-panel-add"
          title="Add a job"
          open={addOpen}
          solo
          onClose={() => {
            setAddOpen(false);
            addButton.current?.focus();
          }}
        >
          <PasteForm nonce={intake.nonce} onAdded={() => setAddedTick(value => value + 1)} />
        </SlidePanel>
      )}
      {moveNotice && (
        <div className="notice notice-warn" role="status">
          <p>{moveNotice}</p>
        </div>
      )}
      {activeFilter && (
        <p className="active-filter" role="status">
          <span>
            Showing: <strong>{activeFilter}</strong>
          </span>
          <button
            type="button"
            className="quiet-button"
            onClick={() =>
              changeQuery({ scoreMin: undefined, scoreMax: undefined, addedWeek: undefined })
            }
          >
            Clear
          </button>
        </p>
      )}
      {cursorNotice && (
        <div className="notice notice-warn" role="status">
          <p>
            This page token expired. The list reloaded from the first page with your current
            filters.
          </p>
        </div>
      )}
      {request.kind === 'loading' && (
        <section className="empty-state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading jobs…
        </section>
      )}
      {request.kind === 'error' && (
        <div className="notice notice-error" role="alert">
          <div>
            <strong>Jobs could not be loaded.</strong>
            <p>{request.error.message}</p>
          </div>
          <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {request.kind === 'success' && response && (
        <>
          <p className="results-summary" aria-live="polite" tabIndex={-1} ref={summaryRef}>
            {busy
              ? 'Updating…'
              : response.totalCount === 0
                ? 'No matching jobs'
                : `Page · ${response.items.length} shown · ${response.totalCount} matching jobs`}
          </p>
          <p className="scroll-hint">Scroll the tables sideways to see score, pay and dates.</p>
          <div className={busy ? 'results-region is-busy' : 'results-region'} aria-busy={busy}>
            {response.items.length === 0 ? (
              <section className="empty-state">
                {response.totalCount === 0 && !query.q && query.filter === 'all' ? (
                  <>
                    <h3>No jobs yet</h3>
                    <p>
                      No evaluated jobs are in the database. Pending jobs appear under the Pending
                      filter.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>
                      {response.totalCount === 0
                        ? 'No jobs match these filters'
                        : 'No jobs on this page'}
                    </h3>
                    <p>Try another search or filter.</p>
                  </>
                )}
              </section>
            ) : query.grouped && groupedItems ? (
              <div className="job-groups">
                {groups
                  .filter(status => groupedItems[status]?.length)
                  .map(status => (
                    <section className="job-group" key={status}>
                      <h3>{status}</h3>
                      {table(groupedItems[status])}
                    </section>
                  ))}
              </div>
            ) : (
              table(response.items)
            )}
          </div>
          <nav className="pagination" aria-label="Jobs pages">
            <button
              className="quiet-button"
              disabled={!response.previousCursor}
              onClick={() => {
                focusResults.current = true;
                updateLocation(query, response.previousCursor);
              }}
            >
              Previous page
            </button>
            <span>{response.totalCount} matching jobs</span>
            <button
              className="quiet-button"
              disabled={!response.nextCursor}
              onClick={() => {
                focusResults.current = true;
                updateLocation(query, response.nextCursor);
              }}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </>
  );
}
