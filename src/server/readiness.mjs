import { query as databaseQuery } from '../lib/_database.mjs';

const readinessSql = `
  SELECT
    ARRAY[
      'jobs', 'evaluations', 'job_status_events', 'job_descriptions'
    ]::text[] <@ ARRAY(
      SELECT c.relname
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ) AS tables_ready,
    ARRAY['create_job', 'change_job_status']::text[] <@ ARRAY(
      SELECT p.proname
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
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
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
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
  constructor() {
    super('Required database schema is not ready');
    this.name = 'SchemaNotReadyError';
  }
}

export function createReadinessCheck({ query = databaseQuery } = {}) {
  return async function checkReadiness() {
    let rows;
    try {
      rows = await query(readinessSql);
    } catch {
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
