/**
 * board-sweep.mjs — cross-company discovery over a private list of public ATS boards.
 *
 * portals.yml entry:
 *   - name: Board sweep
 *     provider: board-sweep
 *     directory: data/board-directory.csv    # optional; header ats_vendor,company_name,board_slug,last_crawled
 *     sweep_interval_days: 7                 # optional, full sweep when state is older
 *     hot_days: 45                           # optional, a board stays hot this long after a passing posting
 *     dead_retry_days: 30                    # optional, boards with 3+ failures are retried after this
 *     concurrency_per_vendor: 12             # optional, one independent pool per vendor (greenhouse, ashby, lever)
 *     require_location_any: [Canada, CAN, Toronto]   # optional, keep only postings whose location contains one
 *     max_per_board: 5                       # optional, postings returned per board per run
 *     sweep_limit: 30                        # optional, cap boards read per run (testing; state is not written)
 *
 * Boards are read through the existing greenhouse, ashby and lever providers with a synthetic
 * entry. Only postings that pass ctx.passesFilters (title and location) are returned, so the scan
 * history never receives the hundreds of thousands of rejected titles a full sweep reads.
 * State (data/board-sweep-state.json): { lastFullSweep, hot: {key: date}, dead: {key: {n, last}} }.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { root } from '../../lib/root.mjs';
import greenhouse from './greenhouse-api.mjs';
import ashby from './ashby-api.mjs';
import lever from './lever-api.mjs';

const DAY_MS = 86_400_000;
const DEAD_AFTER = 3;
const BACKOFF_MS = 5000;
const STOP_AFTER_BOARDS = 50;
const isRateLimit = err => /HTTP (429|503)\b/.test(String(err?.message ?? err));
// Only a missing board or an unreadable response marks a board as dead.
const isDeadBoard = err =>
  /HTTP (404|410)\b/.test(String(err?.message ?? err)) ||
  err instanceof SyntaxError ||
  /invalid|not an array|Unexpected token/i.test(String(err?.message ?? err));
// Path-safe slug; a slug made only of dots ("." or "..") would climb the URL path and is refused.
const SLUG = /^(?!\.+$)[A-Za-z0-9._~-]+$/;

// Minimal CSV reader: quoted fields may contain commas and doubled quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

export function readDirectory(file) {
  const [header, ...rows] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const col = name => header.indexOf(name);
  const [v, n, s] = [col('ats_vendor'), col('company_name'), col('board_slug')];
  if (v < 0 || n < 0 || s < 0)
    throw new Error('board-sweep: directory needs ats_vendor, company_name, board_slug columns');
  return rows
    .map(r => ({
      vendor: (r[v] || '').trim().toLowerCase(),
      company: r[n] || '',
      slug: (r[s] || '').trim(),
    }))
    .filter(r => r.vendor && r.slug);
}

// Optional location requirement: case-insensitive; an entry of at most 4 letters ("CAN", "GTA")
// matches as a whole word, longer entries as substrings. A missing location never matches.
// A single string is a one-entry list; entries that are not non-empty strings are ignored.
export function normalizeLocationTerms(list) {
  const items = typeof list === 'string' ? [list] : Array.isArray(list) ? list : [];
  return items.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().toLowerCase());
}

export function buildLocationRequirement(list) {
  const terms = normalizeLocationTerms(list);
  if (terms.length === 0) return () => true;
  const matchers = terms.map(t => {
    if (/^[a-z]{1,4}$/.test(t)) {
      const re = new RegExp('(?<![a-z0-9])' + t + '(?![a-z0-9])');
      return lower => re.test(lower);
    }
    return lower => lower.includes(t);
  });
  return location => {
    if (typeof location !== 'string' || !location.trim()) return false;
    const lower = location.toLowerCase();
    return matchers.some(m => m(lower));
  };
}

const boardKey = row => `${row.vendor}:${row.slug}`;

// Slugs of boards already tracked as their own portals.yml entry, per vendor.
export function trackedSlugs(entries = []) {
  const set = new Set();
  for (const e of entries) {
    if (e.greenhouse_board) set.add(`greenhouse:${String(e.greenhouse_board).toLowerCase()}`);
    if (e.ashby_board) set.add(`ashby:${String(e.ashby_board).toLowerCase()}`);
    const lv = e.careers_url?.match(/jobs\.lever\.co\/([^/?#]+)/)?.[1];
    if (lv) set.add(`lever:${lv.toLowerCase()}`);
    const gh = (e.api || e.careers_url || '').match(
      /(?:boards-api\.greenhouse\.io\/v1\/boards|boards\.greenhouse\.io)\/([^/?#]+)/,
    )?.[1];
    if (gh) set.add(`greenhouse:${gh.toLowerCase()}`);
    const ab = e.careers_url?.match(/jobs\.ashbyhq\.com\/([^/?#]+)/)?.[1];
    if (ab) set.add(`ashby:${ab.toLowerCase()}`);
  }
  return set;
}

// One board through the existing provider, with the synthetic entry that provider expects.
// Returns { read, jobs }. Greenhouse boards first request the light list (no `content=true`) and
// only fetch the full board, through the provider, when at least one posting passes the filters.
async function readBoard(row, ctx) {
  const entry = { name: row.company };
  if (row.vendor === 'greenhouse') {
    const board = { ...entry, greenhouse_board: row.slug };
    if (ctx.passesFilters) {
      const light = await ctx.getJson(
        `https://boards-api.greenhouse.io/v1/boards/${row.slug}/jobs`,
      );
      if (!Array.isArray(light?.jobs)) throw new Error('invalid response');
      const any = light.jobs.some(j =>
        ctx.passesFilters({
          title: j.title,
          location: j.location?.name || '',
          url: j.absolute_url,
        }),
      );
      if (!any) return { read: light.jobs.length, jobs: [] };
      return { read: light.jobs.length, jobs: await greenhouse.fetch(board, ctx) };
    }
    const jobs = await greenhouse.fetch(board, ctx);
    return { read: jobs.length, jobs };
  }
  const jobs =
    row.vendor === 'ashby'
      ? await ashby.fetch({ ...entry, ashby_board: row.slug }, ctx)
      : await lever.fetch({ ...entry, careers_url: `https://jobs.lever.co/${row.slug}` }, ctx);
  return { read: jobs.length, jobs };
}
const VENDORS = new Set(['greenhouse', 'ashby', 'lever']);

function readState(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return {
      lastFullSweep: typeof s.lastFullSweep === 'string' ? s.lastFullSweep : null,
      hot: s.hot && typeof s.hot === 'object' ? s.hot : {},
      dead: s.dead && typeof s.dead === 'object' ? s.dead : {},
    };
  } catch {
    return null;
  }
}

function writeState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

const resolvePath = p => (path.isAbsolute(p) ? p : path.resolve(root, p));

export default {
  id: 'board-sweep',

  // Never auto-detected: always selected with an explicit `provider: board-sweep`.
  detect() {
    return null;
  },

  async fetch(entry, ctx) {
    const directory = resolvePath(entry.directory || 'data/board-directory.csv');
    const stateFile = resolvePath(entry.state_file || 'data/board-sweep-state.json');
    if (!existsSync(directory)) throw new Error('board-sweep: board directory not found');
    const intervalMs = (entry.sweep_interval_days ?? 7) * DAY_MS;
    const hotMs = (entry.hot_days ?? 45) * DAY_MS;
    const deadRetryMs = (entry.dead_retry_days ?? 30) * DAY_MS;
    const perVendor = Math.max(1, entry.concurrency_per_vendor ?? 12);
    const limit = entry.sweep_limit ?? null;
    const nowMs = (ctx.now ?? Date.now)();
    const today = new Date(nowMs).toISOString().slice(0, 10);

    const tracked = trackedSlugs(ctx.trackedEntries);
    const all = readDirectory(directory).filter(
      r => !tracked.has(`${r.vendor}:${r.slug.toLowerCase()}`),
    );

    const prior = readState(stateFile);
    // An unparseable lastFullSweep counts as "no full sweep yet", never as recent.
    const lastFull = Date.parse(prior?.lastFullSweep ?? '');
    const full = !Number.isFinite(lastFull) || nowMs - lastFull > intervalMs;
    const state = prior ?? { lastFullSweep: null, hot: {}, dead: {} };

    let rows = all.filter(r => {
      const key = boardKey(r);
      const dead = state.dead[key];
      if (dead && dead.n >= DEAD_AFTER && nowMs - Date.parse(dead.last ?? '') < deadRetryMs)
        return false;
      if (full) return true;
      const hotDate = Date.parse(state.hot[key] ?? '');
      return Number.isFinite(hotDate) && nowMs - hotDate <= hotMs;
    });
    rows = rows.filter(r => SLUG.test(r.slug) && VENDORS.has(r.vendor));
    if (limit) {
      // Round-robin across vendors so a capped run exercises every vendor pool.
      const lanes = [...VENDORS].map(v => rows.filter(r => r.vendor === v));
      rows = [];
      for (let i = 0; rows.length < limit && lanes.some(l => i < l.length); i++)
        for (const lane of lanes) if (i < lane.length && rows.length < limit) rows.push(lane[i]);
    }

    const sleep = ms => (ctx.sleep ? ctx.sleep(ms) : new Promise(r => setTimeout(r, ms)));
    const now = ctx.now ?? Date.now;

    const stats = { live: 0, errors: 0, read: 0, passed: 0, droppedLocation: 0 };
    const capped = [];
    const rawCap = entry.max_per_board;
    const maxPerBoard =
      rawCap !== null && rawCap !== '' && Number.isFinite(Number(rawCap)) && Number(rawCap) >= 1
        ? Math.floor(Number(rawCap))
        : 5;
    if (
      entry.require_location_any != null &&
      normalizeLocationTerms(entry.require_location_any).length === 0
    )
      console.log(
        'board-sweep: require_location_any has no usable entry; no location requirement applied',
      );
    const locationOk = buildLocationRequirement(entry.require_location_any);
    const out = [];
    const seenUrls = new Set();
    let cutShort = false;

    // One independent pool per vendor. A 429/503 halves that vendor's pool (minimum 1) and pauses
    // it for 5 s; the pool is never restored during the run.
    const vendors = {};
    for (const v of VENDORS)
      vendors[v] = {
        queue: rows.filter(r => r.vendor === v),
        next: 0,
        limit: perVendor,
        notBefore: 0,
        responses: 0, // 429/503 responses seen
        boards: 0, // boards that still failed after the retry
        stopped: false,
      };

    async function readWithBackoff(row, vendor) {
      for (let attempt = 0; ; attempt++) {
        const wait = vendor.notBefore - now();
        if (wait > 0) await sleep(wait);
        try {
          return await readBoard(row, ctx);
        } catch (err) {
          if (!isRateLimit(err)) throw err;
          vendor.responses++;
          vendor.limit = Math.max(1, Math.floor(vendor.limit / 2));
          vendor.notBefore = now() + BACKOFF_MS;
          if (attempt >= 1) {
            vendor.boards++;
            if (vendor.boards > STOP_AFTER_BOARDS && !vendor.stopped) vendor.stopped = true;
            throw err;
          }
        }
      }
    }

    async function worker(vendor, index) {
      while (vendor.next < vendor.queue.length && !vendor.stopped && index < vendor.limit) {
        const row = vendor.queue[vendor.next++];
        const key = boardKey(row);
        try {
          const { read, jobs } = await readWithBackoff(row, vendor);
          if (!Array.isArray(jobs)) throw new Error('invalid response');
          stats.live++;
          stats.read += read;
          delete state.dead[key];
          let passing = 0;
          let unseen = 0;
          let returned = 0;
          for (const job of jobs) {
            if (ctx.passesFilters && !ctx.passesFilters(job)) continue;
            if (!locationOk(job.location)) {
              stats.droppedLocation++;
              continue;
            }
            passing++;
            // Already tracked postings are neither returned nor counted against the cap.
            if (ctx.shouldFetchContent && !ctx.shouldFetchContent(job)) continue;
            if (!job.url || seenUrls.has(job.url)) continue;
            unseen++;
            if (returned >= maxPerBoard) continue;
            seenUrls.add(job.url);
            out.push(job);
            returned++;
          }
          stats.passed += passing;
          if (unseen > maxPerBoard) capped.push({ slug: row.slug, passing: unseen });
          if (passing > 0) state.hot[key] = today;
        } catch (err) {
          stats.errors++;
          // Only a missing board (404/410) or an invalid response counts toward "dead";
          // rate limits, timeouts and other transient failures never do.
          if (isDeadBoard(err)) {
            const prev = state.dead[key];
            state.dead[key] = { n: (prev?.n ?? 0) + 1, last: today };
          }
        }
        const done = stats.live + stats.errors;
        if (done % 500 === 0)
          console.log(
            `board-sweep: ${done}/${rows.length} boards read, ${out.length} passed so far`,
          );
      }
    }
    await Promise.all(
      Object.values(vendors).flatMap(vendor =>
        Array.from({ length: Math.min(perVendor, vendor.queue.length) }, (_, i) =>
          worker(vendor, i),
        ),
      ),
    );

    const stopped = Object.entries(vendors).filter(([, v]) => v.stopped);
    if (stopped.length) cutShort = true;
    const rate = Object.entries(vendors)
      .map(([name, v]) => `${name} ${v.responses}`)
      .join(', ');
    console.log(
      `board-sweep: ${full ? 'full sweep' : 'hot boards only'}, ${rows.length} boards, ${stats.live} live, ${stats.errors} errors, ${stats.read} postings read, ${stats.passed} passed filters, ${stats.droppedLocation} dropped by require_location_any, 429/503 responses: ${rate}`,
    );
    if (capped.length)
      console.log(
        `board-sweep: capped ${capped.length} boards (${capped
          .sort((a, b) => b.passing - a.passing)
          .slice(0, 10)
          .map(c => `${c.slug} ${c.passing}`)
          .join(', ')})`,
      );
    for (const [name, v] of stopped)
      console.log(
        `board-sweep: stopped reading ${name} after ${v.boards} rate-limited boards; sweep cut short, not recorded as a completed full sweep`,
      );

    // A capped (test) run or a dry run never touches the state file; a cut-short sweep keeps
    // the previous lastFullSweep so the next run is not skipped as "recent".
    if (!ctx.dryRun && !limit) {
      if (full && !cutShort) state.lastFullSweep = new Date(nowMs).toISOString();
      for (const [k, d] of Object.entries(state.hot))
        if (!(nowMs - Date.parse(d) <= hotMs)) delete state.hot[k];
      writeState(stateFile, state);
    }
    return out;
  },
};
