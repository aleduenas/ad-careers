import { formatDateTime, scoreText } from '../../lib/format';
import { actorLabel, type DetailData } from '../../lib/materials';

/** The History panel: status events and evaluation runs for the job. */
export function HistoryPanelBody({ detail }: { detail: DetailData }) {
  const { history, evaluation } = detail;
  return (
    <>
      <section className="workspace-section" aria-labelledby="history-title">
        <h3 id="history-title">Status history</h3>
        <p className="pane-meta">
          Every status change for this job, newest first, and what made it.
        </p>
        {history.length === 0 ? (
          <p className="missing-copy">No status events are recorded for this job.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Status history" tabIndex={0}>
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Change</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {history.map(event => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.occurredAt)}</td>
                    <td>
                      {event.oldStatus
                        ? `${event.oldStatus} → ${event.newStatus}`
                        : `Created as ${event.newStatus}`}
                    </td>
                    <td>{event.reason || '—'}</td>
                    <td>{actorLabel(event.actor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="workspace-section" aria-labelledby="eval-history-title">
        <h3 id="eval-history-title">Evaluation history</h3>
        {evaluation.history.length === 0 ? (
          <p className="missing-copy">No evaluation runs are recorded for this job.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Evaluation history" tabIndex={0}>
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">When</th>
                  <th scope="col">Score</th>
                  <th scope="col">Result status</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.history.map(run => (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td>{scoreText(run.score)}</td>
                    <td>{run.resultStatus || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
