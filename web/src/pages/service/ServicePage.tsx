import { buildMessage, buildRelation, PAGE_BUILD, type EndpointState } from '../../api';
import type { SessionResponse } from '../../generated/api';
import { formatDateTime } from '../../lib/format';
import { ErrorDetails } from '../../components/ErrorDetails';
import type { Connection } from '../../lib/connection';

const capabilityLabels: [keyof SessionResponse['data']['capabilities'], string][] = [
  ['jobReads', 'Job browsing'],
  ['jobDetail', 'Job workspace'],
  ['jobWrites', 'Editing'],
  ['intake', 'Add a job and scan'],
  ['providerSettings', 'Provider settings'],
  ['taskDispatch', 'Background runs'],
];

type StampedState = EndpointState<{ meta: { requestId: string; observedAt: string } }>;

export function ServicePage({
  connection,
  loading,
  onRefresh,
}: {
  connection: Connection;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { health, ready, session } = connection;
  const rows: { name: string; state: StampedState }[] = [
    { name: 'Application health', state: health },
    { name: 'Database readiness', state: ready },
    { name: 'Dashboard session', state: session },
  ];
  const sessionData = session.kind === 'success' ? session.value.data : null;
  const relation = sessionData ? buildRelation(sessionData.build) : 'same';
  const describeBuild = (value: string) =>
    value === 'dev' ? 'Development (not a built copy)' : formatDateTime(value);
  const dispatchReason = (reason: string | null) =>
    reason === 'notConfigured'
      ? 'Not configured'
      : reason === 'notAvailable'
        ? 'Not available'
        : 'Ready';
  return (
    <div className="service-page">
      <section className="connection-summary" aria-label="Service status">
        <div className="section-heading">
          <div>
            <h2>Service status</h2>
            <p>Health, readiness and session checks.</p>
          </div>
          <button className="quiet-button" onClick={onRefresh} disabled={loading}>
            Refresh status
          </button>
        </div>
        <div className="status-grid">
          <EndpointCard title="Application health" state={health} />
          <EndpointCard title="Database readiness" state={ready} />
          <EndpointCard title="Dashboard session" state={session} />
        </div>
        {health.kind === 'success' && ready.kind === 'error' && (
          <div className="notice notice-warn" role="status">
            <div>
              <strong>Database readiness is unavailable.</strong>
              <p>{ready.error.message} Check your database connection, then retry.</p>
            </div>
            <button onClick={onRefresh} disabled={loading}>
              Retry readiness
            </button>
          </div>
        )}
      </section>
      <section className="panel-card" aria-labelledby="service-db-title">
        <h2 id="service-db-title">Database</h2>
        <dl className="service-facts">
          <div>
            <dt>Connection</dt>
            <dd>
              {ready.kind === 'success'
                ? 'Ready'
                : ready.kind === 'error'
                  ? 'Unavailable'
                  : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>
              {ready.kind === 'success' ? 'Ready' : ready.kind === 'error' ? 'Unknown' : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>Background runs</dt>
            <dd>
              {ready.kind === 'success'
                ? ready.value.data.taskDispatch.ready
                  ? 'Ready'
                  : dispatchReason(ready.value.data.taskDispatch.reason)
                : 'Unknown'}
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel-card" aria-labelledby="service-session-title">
        <h2 id="service-session-title">Session and build</h2>
        {sessionData ? (
          <dl className="service-facts">
            <div>
              <dt>API version</dt>
              <dd>{sessionData.apiVersion}</dd>
            </div>
            <div>
              <dt>Service build</dt>
              <dd>{describeBuild(sessionData.build)}</dd>
            </div>
            <div>
              <dt>This page was built</dt>
              <dd>{describeBuild(PAGE_BUILD)}</dd>
            </div>
            <div>
              <dt>Running copy</dt>
              <dd>
                {relation === 'same'
                  ? 'Current'
                  : relation === 'pageOlder'
                    ? 'This page is older than the service. ' + buildMessage(relation)
                    : 'The service is older than this page. ' + buildMessage(relation)}
              </dd>
            </div>
            {capabilityLabels.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{sessionData.capabilities[key] ? 'Available' : 'Not offered'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="missing-copy">
            {session.kind === 'loading' ? 'Checking…' : 'The session could not be read.'}
          </p>
        )}
      </section>
      <section className="panel-card" aria-labelledby="service-requests-title">
        <h2 id="service-requests-title">Request ids</h2>
        <p className="pane-meta">Quote these when reporting a problem.</p>
        <div className="table-scroll" role="region" aria-label="Request ids" tabIndex={0}>
          <table className="service-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
                <th scope="col">Request id</th>
                <th scope="col">Observed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, state }) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>
                    {state.kind === 'success'
                      ? 'Available'
                      : state.kind === 'error'
                        ? 'Unavailable'
                        : 'Checking'}
                  </td>
                  <td>
                    <code>
                      {state.kind === 'success'
                        ? state.value.meta.requestId
                        : state.kind === 'error'
                          ? (state.error.requestId ?? 'None (no reply)')
                          : '-'}
                    </code>
                  </td>
                  <td>
                    {state.kind === 'success' ? formatDateTime(state.value.meta.observedAt) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EndpointCard({ title, state }: { title: string; state: EndpointState<unknown> }) {
  if (state.kind === 'loading')
    return (
      <section className="status-card" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> <strong>{title}</strong>
        <span>Checking...</span>
      </section>
    );
  if (state.kind === 'error')
    return (
      <section className="status-card status-error">
        <span className="status-dot" />
        <strong>{title}</strong>
        <span>{state.error.message}</span>
        <ErrorDetails error={state.error} />
      </section>
    );
  return (
    <section className="status-card status-ok">
      <span className="status-dot" />
      <strong>{title}</strong>
      <span>Available</span>
    </section>
  );
}
