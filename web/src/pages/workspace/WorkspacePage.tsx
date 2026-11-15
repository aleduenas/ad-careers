import { useEffect, useState, type KeyboardEvent, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { SlidePanel } from '../../components/SlidePanel';
import { JobLocationReview } from '../../components/LocationReview';
import { materialHref } from '../../lib/materials';
import { type EditContext } from './StatusControl';
import { useLetter, LetterModal } from './LetterEditor';
import { useSplitRatio } from './useSplitRatio';
import { useJobDetail } from './useJobDetail';
import { useWorkspacePanels, type WorkspacePanel } from './useWorkspacePanels';
import { useHeaderActions } from './useHeaderActions';
import { WorkspaceBar } from './WorkspaceBar';
import { WorkspaceFallback } from './WorkspaceFallback';
import { ReportPane } from './ReportPane';
import { JdPane } from './JdPane';
import { ToolRail } from './ToolRail';
import { ActionsPanelBody } from './ActionsPanelBody';
import { StatusPanelBody } from './StatusPanelBody';
import { NotesSections } from './NotesSections';
import { HistoryPanelBody } from './HistoryPanelBody';
import { MaterialsPanelBody } from './MaterialsPanelBody';

// ---- Package 4.3 F11 (D067): full-page workspace. The report and the job description share the page
// with a draggable divider; the tools live in slide-out panels opened from a rail at the right edge.
export function WorkspacePage({
  id,
  writer,
  dispatch,
  onHeading,
  chrome,
}: {
  id: string;
  writer: { nonce: string } | null;
  dispatch: { nonce: string } | null;
  onHeading: (heading: { title: string; lead: string } | null) => void;
  /** Connection status, Connection details and the theme button, shown at the end of the top bar. */
  chrome: ReactNode;
}) {
  const { state, reload, refresh, applyJob, applyJd } = useJobDetail(id);
  const [pane, setPane] = useState<'jd' | 'evaluation'>('jd');
  const [runsHost, setRunsHost] = useState<HTMLElement | null>(null);
  const { openPanel, setOpenPanel, railButtons, toggle, closePanel } = useWorkspacePanels();
  const [evaluateRequest, setEvaluateRequest] = useState(0);
  const [evaluateDialogRequest, setEvaluateDialogRequest] = useState(0);
  const [evaluateIssue, setEvaluateIssue] = useState<string | null>(null);
  const header = useHeaderActions();
  const [letterOpen, setLetterOpen] = useState(false);
  const split = useSplitRatio();
  const [cacheSync, setCacheSync] = useState<'ok' | 'error'>('ok');
  const ctx: EditContext | null = writer
    ? { id, nonce: writer.nonce, refresh, applyJob, applyJd }
    : null;
  // The saved cover letter is read only when something here can use it (the editor or Publish PDF).
  const detailNow = state.kind === 'success' ? state.value.data : null;
  const letterItem =
    detailNow && !detailNow.materials.ambiguous && detailNow.materials.match !== 'none'
      ? detailNow.materials.items.find(
          item => item.key === 'letter' && item.name === 'cover-letter.md',
        )
      : undefined;
  const letter = useLetter(
    id,
    Boolean(letterItem) && Boolean(writer || dispatch),
    letterItem?.modifiedAt ?? '',
  );
  const [letterDirty, setLetterDirty] = useState(false);
  // The page heading names the job: company and role as the title, the job number as the lead.
  const headingJob = state.kind === 'success' ? state.value.data.job : null;
  useEffect(() => {
    onHeading(
      headingJob
        ? {
            title: [
              headingJob.company || 'Company missing',
              headingJob.role || 'Role missing',
            ].join(' · '),
            lead: `Job #${headingJob.id}`,
          }
        : null,
    );
    return () => onHeading(null);
  }, [headingJob?.company, headingJob?.role, headingJob?.id]);

  const backLink = (
    <a className="back-link" href={`${location.search}#/jobs`}>
      ← Back to jobs
    </a>
  );
  if (state.kind !== 'success') {
    const back = (
      <header className="ws-bar ws-bar-bare">
        {backLink}
        <h1>Job workspace</h1>
        <div className="ws-chrome">{chrome}</div>
      </header>
    );
    return <WorkspaceFallback state={state} id={id} back={back} onRetry={reload} />;
  }

  const detail = state.value.data;
  const { job, materials } = detail;
  const moveTab = (event: KeyboardEvent, current: 'jd' | 'evaluation') => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = current === 'jd' ? 'evaluation' : 'jd';
    setPane(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const panel = (key: WorkspacePanel, title: string, children: ReactNode) => (
    <SlidePanel
      key={key}
      id={`ws-panel-${key}`}
      title={title}
      open={openPanel === key}
      onClose={() => closePanel(key)}
    >
      {children}
    </SlidePanel>
  );
  const goToJdEditor = () => {
    setOpenPanel(null);
    setPane('jd');
    window.setTimeout(() => {
      const target =
        document.querySelector<HTMLElement>('#pane-jd [data-jd-edit]') ??
        document.querySelector<HTMLElement>('#pane-jd textarea');
      target?.focus();
    }, 0);
  };
  const letterFile = materials.items.find(m => m.key === 'letter');

  return (
    <article className="workspace ws">
      <WorkspaceBar
        detail={detail}
        ctx={ctx}
        dispatch={dispatch}
        chrome={chrome}
        backLink={backLink}
        letter={letter}
        header={header}
        onEvaluate={() => {
          setEvaluateIssue(null);
          setEvaluateRequest(value => value + 1);
        }}
        onOpenLetter={() => setLetterOpen(true)}
        onPostingChecked={refresh}
      />
      {letterOpen &&
        letter.state.kind === 'ok' &&
        createPortal(
          <LetterModal
            jobId={job.id}
            letter={letter.state.data}
            writer={writer}
            fileHref={materialHref(job.id, 'letter', letterFile?.name)}
            fileName={letterFile?.name ?? 'cover-letter.md'}
            canPublish={Boolean(dispatch)}
            publishNote={
              !detail.actions.publish.enabled
                ? (detail.actions.publish.reason ?? 'Not available right now.')
                : letterDirty
                  ? 'Save first.'
                  : null
            }
            onPublish={() => header.ask('publish')}
            onApply={letter.apply}
            onDirty={setLetterDirty}
            onReload={letter.reload}
            onClose={() => setLetterOpen(false)}
          />,
          document.body,
        )}

      <JobLocationReview jobId={job.id} status={job.status} onChanged={() => void refresh()} />
      <div className="ws-body">
        <div className="ws-center">
          <div className="pane-tabs" role="tablist" aria-label="Job text">
            {(['jd', 'evaluation'] as const).map(key => (
              <button
                key={key}
                id={`tab-${key}`}
                role="tab"
                aria-selected={pane === key}
                aria-controls={`pane-${key}`}
                tabIndex={pane === key ? 0 : -1}
                className="quiet-button"
                onClick={() => setPane(key)}
                onKeyDown={event => moveTab(event, key)}
              >
                {key === 'jd' ? 'Job description' : 'Evaluation'}
              </button>
            ))}
          </div>
          <div
            className="ws-split"
            ref={split.ref}
            style={{ '--ws-left': `${split.ratio}%` } as CSSProperties}
          >
            <ReportPane
              detail={detail}
              active={pane === 'evaluation'}
              dispatch={dispatch}
              evaluateIssue={evaluateIssue}
              onEvaluate={() => setEvaluateRequest(value => value + 1)}
              onEvaluateWithModel={() => setEvaluateDialogRequest(value => value + 1)}
            />
            <div
              className="ws-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the evaluation report and the job description"
              aria-valuemin={split.min}
              aria-valuemax={split.max}
              aria-valuenow={split.ratio}
              aria-valuetext={`Report ${split.ratio} percent, job description ${100 - split.ratio} percent`}
              tabIndex={0}
              {...split.handlers}
            />
            <JdPane
              jd={detail.jd}
              ctx={ctx}
              active={pane === 'jd'}
              cacheSync={cacheSync}
              onCacheSync={setCacheSync}
            />
          </div>
        </div>
        <ToolRail
          statusLabel={ctx ? 'Status' : 'Notes'}
          showActions={dispatch !== null}
          openPanel={openPanel}
          railButtons={railButtons}
          onToggle={toggle}
        />
      </div>

      {dispatch &&
        panel(
          'actions',
          'Actions',
          <ActionsPanelBody
            detail={detail}
            nonce={dispatch.nonce}
            refresh={refresh}
            letter={letter}
            letterDirty={letterDirty}
            runsHost={runsHost}
            setRunsHost={setRunsHost}
            evaluateRequest={evaluateRequest}
            evaluateDialogRequest={evaluateDialogRequest}
            header={header}
            onInlineIssue={setEvaluateIssue}
            onInlineStarted={() => setOpenPanel('actions')}
          />,
        )}
      {ctx &&
        panel(
          'status',
          'Status and details',
          <StatusPanelBody job={job} ctx={ctx} onGoToJd={goToJdEditor} />,
        )}
      {!ctx &&
        panel(
          'status',
          'Notes',
          <>
            {' '}
            <NotesSections job={job} />
          </>,
        )}
      {panel('history', 'History', <HistoryPanelBody detail={detail} />)}
      {panel(
        'letter',
        'Letter and materials',
        <MaterialsPanelBody
          detail={detail}
          writer={writer}
          letter={letter}
          onDirty={setLetterDirty}
        />,
      )}
    </article>
  );
}
