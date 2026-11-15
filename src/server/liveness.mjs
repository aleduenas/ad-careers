import { query as databaseQuery } from '../lib/_database.mjs';
import { isLivenessRunning, readLastFullCheck } from '../scan/liveness-store.mjs';
import { checkReadiness } from './readiness.mjs';

// Server side of the posting liveness check (D117). It answers the summary route and owns the
// daily run, modelled on ghosting.mjs: every hour, once readiness succeeds, if the last full
// check finished more than a day ago (or there is none) it starts one whole-board run through the
// run service. It never overlaps itself or a scan, and the app creates it with the daily timer
// only with the default pool (never in tests or fixture servers).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function createLiveness({
  query = databaseQuery,
  readiness = checkReadiness,
  dispatch = null,
  activeScan = async () => null,
  daily = false,
  intervalMs = HOUR_MS,
  now = () => new Date(),
  log = message => console.log(message),
  onError = () => {},
} = {}) {
  for (const adapter of [query, readiness, activeScan, now, log, onError])
    if (typeof adapter !== 'function') throw new TypeError('Liveness adapters must be functions.');
  if (dispatch !== null && typeof dispatch !== 'function')
    throw new TypeError('dispatch must be a function.');
  let timer = null;
  let starting = false;

  // { running, lastFullCheck } for GET /api/v1/liveness/summary.
  async function summary() {
    const [running, lastFullCheck] = await Promise.all([
      isLivenessRunning(query),
      readLastFullCheck(query),
    ]);
    return { running, lastFullCheck };
  }

  // One pass. Returns 'started', or the reason nothing was started.
  async function runOnce() {
    if (starting || !dispatch) return 'skipped';
    starting = true;
    try {
      await readiness();
      const current = await summary();
      if (current.running) return 'running';
      const last = current.lastFullCheck?.finishedAt;
      if (last && now().getTime() - Date.parse(last) < DAY_MS) return 'fresh';
      if (await activeScan()) return 'scan-active';
      // A new key per hour: a failed attempt is retried at the next pass, a replay is not.
      const key = `liveness-daily-${now().toISOString().slice(0, 13).replace(/[-:]/g, '')}`;
      await dispatch({ action: 'liveness', requestKey: key });
      log('Posting check: daily run started.');
      return 'started';
    } catch (error) {
      onError(error);
      log('Posting check: daily run skipped.');
      return 'skipped';
    } finally {
      starting = false;
    }
  }

  function start() {
    if (timer || !daily) return;
    runOnce();
    timer = setInterval(runOnce, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return Object.freeze({ summary, runOnce, start, stop });
}
