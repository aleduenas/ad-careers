import type { DetailJob } from '../../api';
import { PostingExpiredLine } from './PostingCheck';
import { NotesSections } from './NotesSections';
import { DetailsEditor } from './DetailsEditor';
import { StatusControl, type EditContext } from './StatusControl';

/** The Status and details panel (read-write session): jump link, editors, notes. */
export function StatusPanelBody({
  job,
  ctx,
  onGoToJd,
}: {
  job: DetailJob;
  ctx: EditContext;
  /** Close the panel, show the job description pane and focus its editor. */
  onGoToJd: () => void;
}) {
  return (
    <>
      <div className="edit-actions">
        <button type="button" className="quiet-button" onClick={onGoToJd}>
          Go to the job description editor
        </button>
      </div>
      <PostingExpiredLine job={job} />
      <div className="edit-grid-outer">
        <StatusControl job={job} ctx={ctx} />
        <DetailsEditor job={job} ctx={ctx} />
      </div>

      <NotesSections job={job} />
    </>
  );
}
