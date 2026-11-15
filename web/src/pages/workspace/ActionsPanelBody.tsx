import type { DetailData } from '../../lib/materials';
import { JobActionsPanel } from './JobActionsPanel';
import type { HeaderActions } from './useHeaderActions';
import type { useLetter } from './LetterEditor';

/** The Actions panel: the run buttons and dialogs, and the host element for the run cards. */
export function ActionsPanelBody({
  detail,
  nonce,
  refresh,
  letter,
  letterDirty,
  runsHost,
  setRunsHost,
  evaluateRequest,
  evaluateDialogRequest,
  header,
  onInlineIssue,
  onInlineStarted,
}: {
  detail: DetailData;
  nonce: string;
  refresh: () => Promise<DetailData | null>;
  letter: ReturnType<typeof useLetter>;
  letterDirty: boolean;
  runsHost: HTMLElement | null;
  setRunsHost: (element: HTMLElement | null) => void;
  evaluateRequest: number;
  evaluateDialogRequest: number;
  header: HeaderActions;
  onInlineIssue: (message: string | null) => void;
  onInlineStarted: () => void;
}) {
  const { job, evaluation } = detail;
  return (
    <>
      <JobActionsPanel
        job={job}
        actions={detail.actions}
        nonce={nonce}
        refresh={refresh}
        letterHash={
          letter.state.kind === 'ok' && letter.state.data.editable
            ? letter.state.data.contentHash
            : null
        }
        letterHasPdf={letter.state.kind === 'ok' && letter.state.data.pdf !== null}
        letterNote={
          letter.state.kind === 'loading'
            ? 'Reading the cover letter…'
            : letter.state.kind === 'error'
              ? 'The cover letter could not be read.'
              : letter.state.kind === 'ok'
                ? 'This cover letter cannot be published from here.'
                : 'No cover letter to publish.'
        }
        letterDirty={letterDirty}
        runsHost={runsHost}
        evaluateRequest={evaluateRequest}
        evaluateDialogRequest={evaluateDialogRequest}
        hasReport={evaluation.report.state === 'ok'}
        onInlineIssue={onInlineIssue}
        onInlineStarted={onInlineStarted}
        headerRequest={header.request}
        onHeaderIssue={message => {
          header.setIssue(message);
          if (message) header.setPending(null);
        }}
        onActiveActions={header.setActive}
        onLetterConflict={current => {
          if (letter.state.kind === 'ok' && current)
            letter.apply({ ...letter.state.data, ...current });
          else letter.reload();
        }}
        onRunsEnded={letter.reload}
      />

      <section className="ws-section" aria-labelledby="runs-title">
        <h3 id="runs-title">Runs and logs</h3>
        <div ref={setRunsHost} />
      </section>
    </>
  );
}
