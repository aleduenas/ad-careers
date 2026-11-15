/**
 * liveness-store.mjs: the PostgreSQL side of the posting liveness check.
 *
 * Every function takes an injected `query(sql, args)` so tests and the CLI choose the connection.
 * The only write to jobs is change_job_status with the fixed reason and actor; a revision
 * conflict skips the job.
 */

export const ACTOR = 'liveness-check';
export const REASON = 'Posting expired';

const DB_ACTIONS = { discard: 'discarded', flag: 'flagged', none: 'none' };

/** The posting_checks.action stored for a decided action. */
export function storedAction(action) {
  if (action.heldBack) return 'held_back';
  return DB_ACTIONS[action.action] ?? 'none';
}

const rowsOf = result => (Array.isArray(result) ? result : (result?.rows ?? []));

/**
 * Jobs eligible for a check (Pending, Evaluated, Applied), with the two facts the decision
 * needs: restored (an earlier liveness discard exists, as a status event or a check row) and
 * activeTask (a queued or running run for the job other than a liveness run, or a live claim).
 */
export async function loadEligibleJobs(query, id = null) {
  const rows = rowsOf(
    await query(
      `SELECT j.id::text AS id, j.url, j.status, j.revision::text AS revision,
         (EXISTS(SELECT 1 FROM job_status_events e WHERE e.job_id=j.id
            AND e.new_status='Discarded' AND e.actor=$1)
          OR EXISTS(SELECT 1 FROM posting_checks c WHERE c.job_id=j.id AND c.action='discarded')
         ) AS restored,
         (EXISTS(SELECT 1 FROM browser_runs r WHERE r.job_id=j.id
            AND r.state IN ('queued','running') AND r.action<>'liveness')
          OR EXISTS(SELECT 1 FROM workflow_claims w WHERE w.expires_at>now()
            AND w.resource LIKE '%:' || j.id::text)
         ) AS active_task
       FROM jobs j
       WHERE j.status IN ('Pending','Evaluated','Applied')${id ? ' AND j.id=$2::bigint' : ''}
       ORDER BY j.id`,
      id ? [ACTOR, id] : [ACTOR],
    ),
  );
  return rows.map(row => ({
    id: row.id,
    url: row.url,
    status: row.status,
    revision: row.revision,
    restored: Boolean(row.restored),
    activeTask: Boolean(row.active_task),
  }));
}

/** Writers for runLiveness: one posting_checks row per check, and the guarded discard. */
export function createLivenessWriter(query) {
  return {
    async recordCheck(job, result, action) {
      await query(
        'INSERT INTO posting_checks(job_id,state,method,detail,action) VALUES($1::bigint,$2,$3,$4,$5)',
        [
          job.id,
          result.state,
          String(result.method || '').slice(0, 40),
          String(result.detail || '').slice(0, 300),
          action,
        ],
      );
    },
    // 'discarded', or 'conflict' when the job changed since it was read (left for the next check).
    async discard(job) {
      try {
        await query('SELECT id FROM change_job_status($1::bigint,$2::bigint,$3,$4,$5)', [
          job.id,
          job.revision,
          'Discarded',
          REASON,
          ACTOR,
        ]);
        return 'discarded';
      } catch (error) {
        if (error?.code === '40001') return 'conflict';
        throw error;
      }
    },
  };
}

/**
 * Summary of the newest completed whole-board check: the checks written between its start and
 * finish. `flagged` counts every flag, including the held-back ones; `heldBack` counts the
 * discards an outage limit turned into flags. Single-job checks made inside the window are counted
 * too (a known approximation: the window is the run's, not a run id on the rows).
 */
export async function readLastFullCheck(query) {
  const [run] = rowsOf(
    await query(
      `SELECT started_at, finished_at FROM browser_runs
       WHERE action='liveness' AND job_id IS NULL AND state='completed' AND finished_at IS NOT NULL
       ORDER BY finished_at DESC, id DESC LIMIT 1`,
      [],
    ),
  );
  if (!run) return null;
  const [counts] = rowsOf(
    await query(
      `SELECT count(*)::int AS checked,
         count(*) FILTER (WHERE state='open')::int AS open,
         count(*) FILTER (WHERE state='closed')::int AS closed,
         count(*) FILTER (WHERE state='probably_closed')::int AS probably_closed,
         count(*) FILTER (WHERE state='unknown')::int AS unknown,
         count(*) FILTER (WHERE action='discarded')::int AS discarded,
         count(*) FILTER (WHERE action IN ('flagged','held_back'))::int AS flagged,
         count(*) FILTER (WHERE action='held_back')::int AS held_back
       FROM posting_checks WHERE checked_at >= $1 AND checked_at <= $2`,
      [run.started_at ?? run.finished_at, run.finished_at],
    ),
  );
  const n = key => Number(counts?.[key] ?? 0);
  return {
    finishedAt: new Date(run.finished_at).toISOString(),
    checked: n('checked'),
    open: n('open'),
    closed: n('closed'),
    probablyClosed: n('probably_closed'),
    unknown: n('unknown'),
    discarded: n('discarded'),
    flagged: n('flagged'),
    heldBack: n('held_back'),
  };
}

export async function isLivenessRunning(query) {
  const [row] = rowsOf(
    await query(
      `SELECT EXISTS(SELECT 1 FROM browser_runs WHERE action='liveness'
         AND state IN ('queued','running')) AS running`,
      [],
    ),
  );
  return Boolean(row?.running);
}
