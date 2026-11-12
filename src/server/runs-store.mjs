import { randomUUID } from 'node:crypto';

// SQL access for browser_runs (migration 010). The query transport is injected so tests and the
// server choose the connection; this module holds no state and never touches business tables.

const COLUMNS =
  'id,request_key,group_id,action,job_id,state,phase,attempt,pid,pid_started_at,exit_code,' +
  'error_code,log_ref,selection,created_at,started_at,updated_at,finished_at';
const iso = value => (value == null ? null : new Date(value).toISOString());

export class RunsStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunsStoreError';
    this.code = code;
  }
}

export function toRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestKey: row.request_key,
    groupId: row.group_id ?? null,
    action: row.action,
    jobId: row.job_id == null ? null : String(row.job_id),
    state: row.state,
    phase: row.phase,
    attempt: row.attempt,
    pid: row.pid ?? null,
    pidStartedAt: iso(row.pid_started_at),
    exitCode: row.exit_code ?? null,
    errorCode: row.error_code ?? null,
    logRef: row.log_ref,
    selection: row.selection ?? {},
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    updatedAt: iso(row.updated_at),
    finishedAt: iso(row.finished_at),
  };
}

const decimalID = (value, name) => {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value))
    throw new RunsStoreError('INVALID_ARGUMENT', name + ' must be a decimal string');
  return value;
};

export function createRunsStore({ query }) {
  if (typeof query !== 'function') throw new TypeError('createRunsStore requires a query function');
  const rows = async (sql, args) => {
    const result = await query(sql, args);
    return Array.isArray(result) ? result : (result?.rows ?? []);
  };
  const one = async (sql, args) => toRun((await rows(sql, args))[0]);
  // Run functions return a whole row; selecting its columns keeps the wire shape explicit.
  const call = (fn, args) =>
    one(
      'SELECT ' + COLUMNS + ' FROM ' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ')',
      args,
    );

  return {
    async insert({ id, requestKey, groupId, action, jobId, logRef, selection }) {
      const args = [
        id ?? randomUUID(),
        requestKey,
        groupId ?? null,
        action,
        decimalID(jobId, 'jobId'),
        logRef,
        JSON.stringify(selection ?? {}),
      ];
      try {
        return await one(
          'INSERT INTO browser_runs(id,request_key,group_id,action,job_id,log_ref,selection) ' +
            'VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING ' +
            COLUMNS,
          args,
        );
      } catch (error) {
        // Map constraint failures to safe codes; raw database text never leaves this module.
        if (error?.code === '23505' && /request_key/.test(error.constraint ?? ''))
          throw new RunsStoreError('REQUEST_KEY_CONFLICT', 'Run request key already used');
        if (error?.code === '23505') throw new RunsStoreError('RUN_CONFLICT', 'Run already exists');
        if (error?.code === '23503')
          throw new RunsStoreError('UNKNOWN_JOB', 'Run references an unknown job');
        if (error?.code === '23514' || error?.code === '22P02')
          throw new RunsStoreError('INVALID_ARGUMENT', 'Run fields are invalid');
        throw error;
      }
    },
    start: (id, pid, pidStartedAt) =>
      call('start_browser_run', [id, pid, pidStartedAt ? new Date(pidStartedAt) : null]),
    report: (id, phase, attempt) => call('report_browser_run', [id, phase, attempt]),
    finish: (id, state, exitCode, errorCode) =>
      call('finish_browser_run', [id, state, exitCode ?? null, errorCode ?? null]),
    async interruptStale({ deadPids = [], now = new Date() } = {}) {
      const pids = [...new Set(deadPids)].filter(p => Number.isInteger(p) && p > 0);
      return (
        await rows('SELECT ' + COLUMNS + ' FROM interrupt_stale_browser_runs($1,$2::integer[])', [
          new Date(now),
          pids,
        ])
      ).map(toRun);
    },
    // Every queued or running run, plus the newest `limit` terminal runs, newest first.
    async list({ jobId, limit = 12 } = {}) {
      const bound = Number.isInteger(limit) && limit >= 0 && limit <= 200 ? limit : 12;
      return (
        await rows(
          'SELECT ' +
            COLUMNS +
            " FROM browser_runs WHERE ($1::bigint IS NULL OR job_id=$1::bigint) AND (state IN ('queued','running') OR id IN (" +
            "SELECT id FROM browser_runs WHERE state NOT IN ('queued','running') AND ($1::bigint IS NULL OR job_id=$1::bigint) " +
            'ORDER BY finished_at DESC,id DESC LIMIT $2)) ORDER BY created_at DESC,id DESC',
          [decimalID(jobId, 'jobId'), bound],
        )
      ).map(toRun);
    },
    get: id => one('SELECT ' + COLUMNS + ' FROM browser_runs WHERE id=$1', [id]),
    getByRequestKey: requestKey =>
      one('SELECT ' + COLUMNS + ' FROM browser_runs WHERE request_key=$1', [requestKey]),
  };
}
