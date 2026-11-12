import { query as databaseQuery } from '../lib/_database.mjs';

const readinessSql = `
  SELECT
    ARRAY[
      'jobs', 'evaluations', 'job_status_events', 'job_descriptions'
    ]::text[] <@ ARRAY(
      SELECT c.relname::text
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relkind IN ('r', 'p')
    ) AS tables_ready,
    ARRAY['create_job', 'change_job_status']::text[] <@ ARRAY(
      SELECT p.proname::text
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = $1::text
    ) AS functions_ready,
    ARRAY[
      'jobs.id', 'jobs.revision', 'jobs.company', 'jobs.role', 'jobs.url', 'jobs.status',
      'jobs.score', 'jobs.source_date', 'jobs.notes', 'jobs.report_path',
      'jobs.salary_min', 'jobs.salary_max', 'scan_history.url', 'scan_history.first_seen',
      'job_status_events.id', 'job_status_events.job_id', 'job_status_events.new_status',
      'job_status_events.occurred_at', 'job_status_events.reason'
    ]::text[] <@ ARRAY(
      SELECT c.relname || '.' || a.attname
      FROM pg_catalog.pg_attribute AS a
      JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
    ) AS read_columns_ready
`;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super('Database unavailable');
    this.name = 'DatabaseUnavailableError';
  }
}

export class SchemaNotReadyError extends Error {
  // `cause` keeps the original driver error for operators; the message stays generic and the
  // public envelope never includes it.
  constructor(cause) {
    super('Required database schema is not ready', cause === undefined ? undefined : { cause });
    this.name = 'SchemaNotReadyError';
  }
}

// A PostgreSQL SQLSTATE is five characters. Connection (08), resource (53), operator
// intervention such as a statement timeout (57), system (58) and authentication (28, 3D) classes
// mean the database cannot be reached or used; anything else is a SQL error, which is a bug in
// the check or a broken catalog and must not be reported as "unavailable".
function isSqlError(error) {
  const code = error?.code;
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return false;
  return !['08', '53', '57', '58', '28', '3D'].includes(code.slice(0, 2));
}

export function createReadinessCheck({ query = databaseQuery, schema = 'public' } = {}) {
  return async function checkReadiness() {
    let rows;
    try {
      rows = await query(readinessSql, [schema]);
    } catch (error) {
      if (isSqlError(error)) throw new SchemaNotReadyError(error);
      throw new DatabaseUnavailableError();
    }
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      !rows[0].tables_ready ||
      !rows[0].functions_ready ||
      !rows[0].read_columns_ready
    )
      throw new SchemaNotReadyError();
    return { ready: true, database: 'ready', schema: 'ready' };
  };
}

export const checkReadiness = createReadinessCheck();
