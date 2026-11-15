import { formatDateTime } from '../../lib/format';
import type { DetailData } from '../../lib/materials';
import { JdText } from './JdText';
import { JdPaneEditable } from './JdEditor';
import type { EditContext } from './StatusControl';

/** The job description pane: editable when the server offers writes, plain text otherwise. */
export function JdPane({
  jd,
  ctx,
  active,
  cacheSync,
  onCacheSync,
}: {
  jd: DetailData['jd'];
  ctx: EditContext | null;
  active: boolean;
  cacheSync: 'ok' | 'error';
  onCacheSync: (next: 'ok' | 'error') => void;
}) {
  return (
    <section
      className="doc-pane"
      id="pane-jd"
      role="tabpanel"
      aria-labelledby="tab-jd"
      data-active={active}
    >
      <h3>Job description</h3>
      {cacheSync === 'error' && (
        <div className="notice notice-warn" role="alert">
          <p>
            Saved to the database, but the cache file under data/jds was not updated. The stored
            description is correct; the cache copy is out of date.
          </p>
        </div>
      )}
      {ctx ? (
        <JdPaneEditable jd={jd} ctx={ctx} onCacheSync={onCacheSync} />
      ) : jd ? (
        <>
          <p className="pane-meta">Stored {formatDateTime(jd.syncedAt)}</p>
          <JdText text={jd.text} />
        </>
      ) : (
        <p className="missing-copy">No job description is stored for this job.</p>
      )}
    </section>
  );
}
