import { ReportMarkdown } from '../../components/ReportMarkdown';
import { reportMessages, type DetailData } from '../../lib/materials';

/** The evaluation report pane, with the evaluate buttons when no report exists yet. */
export function ReportPane({
  detail,
  active,
  dispatch,
  evaluateIssue,
  onEvaluate,
  onEvaluateWithModel,
}: {
  detail: DetailData;
  active: boolean;
  dispatch: { nonce: string } | null;
  evaluateIssue: string | null;
  onEvaluate: () => void;
  onEvaluateWithModel: () => void;
}) {
  const { job, evaluation } = detail;
  const reportText = evaluation.report.text;
  return (
    <section
      className="doc-pane"
      id="pane-evaluation"
      role="tabpanel"
      aria-labelledby="tab-evaluation"
      data-active={active}
    >
      <h3>Evaluation report</h3>
      {job.evaluationError && (
        <p className="missing-copy">The last evaluation run for this job recorded an error.</p>
      )}
      {evaluation.report.state === 'ok' && reportText !== null ? (
        reportText ? (
          <ReportMarkdown text={reportText} />
        ) : (
          <p className="missing-copy">The evaluation report is empty.</p>
        )
      ) : evaluation.report.state === 'missing' && dispatch ? (
        <div className="report-empty">
          <p className="missing-copy">{reportMessages.missing}</p>
          {evaluateIssue && (
            <p className="field-error" role="alert">
              {evaluateIssue}
            </p>
          )}
          {detail.actions.evaluate.enabled ? (
            <div className="action-pair">
              <button
                className="primary-button"
                onClick={() => {
                  onEvaluate();
                }}
              >
                Evaluate this job
              </button>
              <button
                className="quiet-button action-with-model"
                aria-label="Evaluate this job with model"
                onClick={() => onEvaluateWithModel()}
              >
                with model
              </button>
            </div>
          ) : (
            <p className="action-reason">
              {detail.actions.evaluate.reason ?? 'Evaluate is not available right now.'}
            </p>
          )}
        </div>
      ) : (
        <p className="missing-copy">
          {reportMessages[evaluation.report.state === 'ok' ? 'invalid' : evaluation.report.state]}
        </p>
      )}
    </section>
  );
}
