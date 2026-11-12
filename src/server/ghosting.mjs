import { query as databaseQuery } from '../lib/_database.mjs';
import { checkReadiness } from './readiness.mjs';

// Server-owned automatic Ghosted rule (STAGE3_EDIT_CONTRACT.md). It calls the SQL function
// ghost_stale_applications() once after readiness succeeds at startup and then every hour. The
// server creates it only with the default pool (never in tests or fixture servers), and the
// result is logged as a count. The TUI's call on every load is not reproduced.

const HOUR_MS = 60 * 60 * 1000;

export function createGhosting({
  query = databaseQuery,
  readiness = checkReadiness,
  intervalMs = HOUR_MS,
  log = message => console.log(message),
  onError = () => {},
} = {}) {
  if (typeof query !== 'function' || typeof readiness !== 'function' || typeof log !== 'function')
    throw new TypeError('Ghosting adapters must be functions.');
  let timer = null;
  let running = false;

  // One pass: readiness first, then the SQL rule. Returns the moved count, or null when the
  // pass could not run. Failures are logged generically; driver text is never printed.
  async function runOnce() {
    if (running) return null;
    running = true;
    try {
      await readiness();
      const rows = await query('SELECT ghost_stale_applications() AS moved');
      const moved = Number(rows?.[0]?.moved ?? 0);
      log(`Ghosting: ${moved} stale application${moved === 1 ? '' : 's'} moved to Ghosted.`);
      return moved;
    } catch (error) {
      onError(error);
      log('Ghosting: skipped (database not ready).');
      return null;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    runOnce();
    timer = setInterval(runOnce, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return Object.freeze({ runOnce, start, stop });
}
