import type { ReactNode } from 'react';
import { letterPdfHref } from '../../api';
import { FavoriteToggle } from '../../components/FavoriteToggle';
import { QuickMoves } from '../../components/QuickMoves';
import { formatDate, formatSalary, compensationText, scoreText } from '../../lib/format';
import { yoeConfidenceText, yoeLabel } from '../../lib/yoe';
import { PostingFact } from './PostingCheck';
import { materialLabels, materialHref, type DetailData } from '../../lib/materials';
import type { EditContext } from './StatusControl';
import type { HeaderActions } from './useHeaderActions';
import type { useLetter } from './LetterEditor';

/** The header bar: job title, the facts grid with quick moves, and the materials strip. */
export function WorkspaceBar({
  detail,
  ctx,
  dispatch,
  chrome,
  backLink,
  letter,
  header,
  onEvaluate,
  onOpenLetter,
  onPostingChecked,
}: {
  detail: DetailData;
  ctx: EditContext | null;
  dispatch: { nonce: string } | null;
  chrome: ReactNode;
  backLink: ReactNode;
  letter: ReturnType<typeof useLetter>;
  header: HeaderActions;
  /** The quick Evaluate button: clear the last inline issue and ask the Actions panel to start. */
  onEvaluate: () => void;
  onOpenLetter: () => void;
  /** Read the job again after a posting check this page started finishes. */
  onPostingChecked: () => void | Promise<unknown>;
}) {
  const { job, materials } = detail;
  const salary = formatSalary(job.salary);
  const letterItemKnown = !materials.ambiguous && materials.items.some(m => m.key === 'letter');
  const { pending: pendingHeader, active: activeActions, ask: askHeader } = header;
  const headerIssue = header.issue;
  return (
    <header className="ws-bar">
      <div className="ws-bar-main">
        {backLink}
        <h1>{[job.company || 'Company missing', job.role || 'Role missing'].join(' · ')}</h1>
        {ctx && (
          <FavoriteToggle
            jobId={job.id}
            label={[job.company || 'Company missing', job.role || 'Role missing'].join(' · ')}
            favorite={job.favorite}
            nonce={ctx.nonce}
            onApply={value => ctx.applyJob({ ...job, favorite: value })}
          />
        )}
        <div className="ws-chrome">{chrome}</div>
      </div>
      <div className="ws-meta">
        <dl className="ws-facts">
          <div>
            <dt>ID</dt>
            <dd>{job.id}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className="ws-status">
              <span className={`job-status status-${job.status.toLowerCase()}`}>{job.status}</span>
              {ctx && (
                <QuickMoves
                  job={job}
                  nonce={ctx.nonce}
                  onMoved={moved => {
                    ctx.applyJob(moved);
                    void ctx.refresh();
                  }}
                  onConflict={ctx.refresh}
                  evaluate={
                    dispatch
                      ? {
                          disabledReason: detail.actions.evaluate.enabled
                            ? null
                            : (detail.actions.evaluate.reason ??
                              'Evaluate is not available right now.'),
                          start: () => {
                            onEvaluate();
                          },
                        }
                      : null
                  }
                />
              )}
            </dd>
          </div>
          <div>
            <dt>Score</dt>
            <dd>{scoreText(job.score, job.status === 'Pending')}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>{formatDate(job.addedDate)}</dd>
          </div>
          <div>
            <dt>Status date</dt>
            <dd>{formatDate(job.statusDate)}</dd>
          </div>
          <div>
            <dt>Compensation</dt>
            <dd>
              {compensationText(job)}
              {salary && <small>Manual range: {salary}</small>}
            </dd>
          </div>
          <div>
            <dt>Experience</dt>
            <dd>
              {job.yoeMin !== null ? yoeLabel(job.yoeMin) : 'No estimate'}
              {job.yoeMin !== null && <small>{yoeConfidenceText(job.yoeConfidence)}</small>}
            </dd>
          </div>
          <div>
            <dt>Posting</dt>
            <dd>
              <PostingFact job={job} nonce={dispatch?.nonce ?? null} onChecked={onPostingChecked} />
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {job.url ? (
                <a href={job.url} target="_blank" rel="noopener noreferrer">
                  Open posting (new tab)
                </a>
              ) : (
                'No source link'
              )}
            </dd>
          </div>
        </dl>
        <div className="ws-materials" aria-label="Materials">
          {(['cv', 'letter'] as const).map(key => {
            const item = materials.ambiguous ? undefined : materials.items.find(m => m.key === key);
            return (
              <div key={key}>
                <span>{materialLabels[key]}</span>
                {item && key === 'letter' && letter.state.kind === 'ok' ? (
                  <button
                    type="button"
                    className="ws-material-link"
                    aria-haspopup="dialog"
                    onClick={() => onOpenLetter()}
                  >
                    {item.name}
                  </button>
                ) : item ? (
                  <a
                    href={materialHref(job.id, key, item.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.name}
                  </a>
                ) : dispatch && !materials.ambiguous ? (
                  <button
                    type="button"
                    className="quiet-button ws-material-button"
                    disabled={
                      pendingHeader === key ||
                      activeActions.includes(key) ||
                      !detail.actions[key].enabled
                    }
                    title={
                      detail.actions[key].enabled
                        ? undefined
                        : (detail.actions[key].reason ?? 'Not available right now.')
                    }
                    onClick={() => askHeader(key)}
                  >
                    {pendingHeader === key || activeActions.includes(key)
                      ? 'Drafting…'
                      : key === 'cv'
                        ? 'Draft CV'
                        : 'Draft cover letter'}
                  </button>
                ) : (
                  <em>{materials.ambiguous ? 'unclear which folder' : 'none yet'}</em>
                )}
              </div>
            );
          })}
          <div>
            <span>Letter PDF</span>
            {letter.state.kind === 'ok' && letter.state.data.pdf !== null ? (
              <a
                href={letterPdfHref(job.id)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open letter PDF (new tab)"
              >
                Open PDF
              </a>
            ) : dispatch &&
              letter.state.kind === 'ok' &&
              letter.state.data.pdf === null &&
              letterItemKnown ? (
              <button
                type="button"
                className="quiet-button ws-material-button"
                disabled={pendingHeader === 'publish' || activeActions.includes('publish')}
                onClick={() => askHeader('publish')}
              >
                {pendingHeader === 'publish' || activeActions.includes('publish')
                  ? 'Publishing…'
                  : 'Publish PDF'}
              </button>
            ) : letter.state.kind === 'loading' ? (
              <em>checking…</em>
            ) : letter.state.kind === 'error' ? (
              <em>could not be read</em>
            ) : letterItemKnown && letter.state.kind === 'idle' ? (
              <em>not checked here</em>
            ) : (
              <em>none yet</em>
            )}
          </div>
        </div>
        {headerIssue && (
          <p className="field-error" role="alert">
            {headerIssue}
          </p>
        )}
        {dispatch &&
          !materials.ambiguous &&
          (['cv', 'letter'] as const)
            .filter(
              key =>
                !materials.items.some(m => m.key === key) &&
                // The button already reads "Drafting…" while a run is active; no second line for it.
                pendingHeader !== key &&
                !activeActions.includes(key) &&
                !detail.actions[key].enabled,
            )
            .map(key => (
              <p className="pane-meta ws-material-reason" key={key}>
                {key === 'cv' ? 'Draft CV' : 'Draft cover letter'} is not available:{' '}
                {detail.actions[key].reason ?? 'not available right now.'}
              </p>
            ))}
      </div>
    </header>
  );
}
