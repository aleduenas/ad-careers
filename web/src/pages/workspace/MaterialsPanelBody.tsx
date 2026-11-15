import { formatSize, formatDateTime } from '../../lib/format';
import { materialLabels, materialHref, type DetailData } from '../../lib/materials';
import { LetterSection, type useLetter } from './LetterEditor';

/** The Letter and materials panel: output files, the cover letter section and interview prep. */
export function MaterialsPanelBody({
  detail,
  writer,
  letter,
  onDirty,
}: {
  detail: DetailData;
  writer: { nonce: string } | null;
  letter: ReturnType<typeof useLetter>;
  onDirty: (dirty: boolean) => void;
}) {
  const { job, materials, interviewPrep } = detail;
  return (
    <>
      <section className="workspace-section" aria-labelledby="materials-title">
        <h3 id="materials-title">Materials</h3>
        {materials.ambiguous ? (
          <p className="missing-copy">
            More than one output folder matches this job, so no materials are shown.
          </p>
        ) : materials.items.length === 0 ? (
          <p className="missing-copy">No CV, cover letter or brief was found for this job.</p>
        ) : (
          <>
            {materials.match === 'legacy' && (
              <p className="pane-meta">Matched by company and role, not by job ID.</p>
            )}
            <ul className="file-list">
              {materials.items.map(item => (
                <li key={item.key}>
                  <div>
                    <strong>{materialLabels[item.key]}</strong>
                    <span>
                      {item.name} · {item.kind.toUpperCase()} · {formatSize(item.size)} · Modified{' '}
                      {formatDateTime(item.modifiedAt)}
                    </span>
                  </div>
                  <a
                    href={materialHref(job.id, item.key, item.name)}
                    title={item.name}
                    target={item.kind === 'pdf' ? '_blank' : undefined}
                    rel={item.kind === 'pdf' ? 'noopener noreferrer' : undefined}
                    aria-label={`Open ${materialLabels[item.key]}${item.kind === 'pdf' ? ' (new tab)' : ' as text'}`}
                  >
                    Open
                  </a>
                </li>
              ))}
            </ul>
            <LetterSection
              jobId={job.id}
              letter={letter.state}
              writer={writer}
              onApply={letter.apply}
              onDirty={onDirty}
              onReload={letter.reload}
            />
          </>
        )}
      </section>

      {job.status === 'Interview' && (
        <section className="workspace-section" aria-labelledby="prep-title">
          <h3 id="prep-title">Interview prep</h3>
          {interviewPrep ? (
            <ul className="file-list">
              <li>
                <div>
                  <strong>{materialLabels.prep}</strong>
                  <span>
                    {interviewPrep.name} · {formatSize(interviewPrep.size)}
                  </span>
                </div>
                <a
                  href={materialHref(job.id, 'prep', interviewPrep.name)}
                  aria-label="Open Interview prep as text"
                >
                  Open
                </a>
              </li>
            </ul>
          ) : (
            <p className="missing-copy">No interview prep file was found for this job.</p>
          )}
        </section>
      )}
    </>
  );
}
