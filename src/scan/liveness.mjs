#!/usr/bin/env node

/**
 * liveness.mjs: is a saved posting still open?
 *
 * checkPosting() asks the employer's own public job board about one posting. A posting is closed
 * only on an explicit answer (API 404/410, absent from a board list that loaded correctly,
 * Workday canApply false). A blocked, failed or timed-out request, or a challenge page, is
 * unknown. decideActions() turns checked jobs into discard / flag / none / skip.
 *
 * Usage:
 *   node src/scan/liveness.mjs --job=ID [--dry-run]
 *   node src/scan/liveness.mjs --all [--dry-run]
 * Without --dry-run each check is stored in posting_checks and closed Pending or Evaluated jobs
 * are discarded through change_job_status (reason "Posting expired", actor "liveness-check").
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { extractDescriptionFromHtml } from './providers/_canonical-jd.mjs';
import { requestWithTimeout } from './providers/_http.mjs';
import { parseSuccessFactorsTiles } from './providers/successfactors.mjs';
import {
  ACTOR,
  REASON,
  createLivenessWriter,
  loadEligibleJobs,
  storedAction,
} from './liveness-store.mjs';
import { createRenderer } from './liveness-render.mjs';
import {
  ashbyParts,
  bamboohrParts,
  boardKey,
  breezyParts,
  greenhouseParts,
  neverRequested,
  leverParts,
  pinpointParts,
  himalayasParts,
  smartrecruitersParts,
  successfactorsParts,
  workableParts,
  workdayParts,
} from './liveness-urls.mjs';

export { ACTOR, REASON };
export const OUTAGE_LIMITS = {
  board: { share: 0.5, min: 5 },
  run: { share: 0.3, min: 20 },
};

const HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
};
const PAGE_HEADERS = { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

const open = method => ({ state: 'open', method, detail: '' });
const closed = (method, detail) => ({ state: 'closed', method, detail });
const unknown = (method, detail) => ({ state: 'unknown', method, detail });
const probablyClosed = (method, detail) => ({ state: 'probably_closed', method, detail });
export const SLOW_DOWN = 'The job board asked us to slow down; not checked this run.';
const answered = status => (status === 429 ? SLOW_DOWN : `The job board answered ${status}.`);

class SlowDownError extends Error {}
const notListed = method => closed(method, "No longer listed on the employer's job board.");

const ask = (url, fetchImpl, headers = HEADERS) => fetchImpl(url, { redirect: 'follow', headers });

// One posting's own API address: 200 open, 404 and 410 gone, anything else says nothing.
async function byAddress(address, method, fetchImpl) {
  const response = await ask(address, fetchImpl);
  if ([404, 410].includes(response.status)) return closed(method, answered(response.status));
  return response.ok ? open(method) : unknown(method, answered(response.status));
}

// The employer's whole board: only a list that loaded as a non-empty array can say "gone".
// True when a list answer points at more items than it carries: a next page, a cursor, or a total
// larger than the items read.
function partialList(data, list) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const scopes = [data, data.meta, data.pagination, data.links, data.paging].filter(
    value => value && typeof value === 'object',
  );
  const pointers = [
    'next',
    'nextPage',
    'next_page',
    'nextCursor',
    'next_cursor',
    'cursor',
    'nextPageToken',
  ];
  const totals = ['total', 'totalCount', 'total_count', 'totalFound', 'count', 'total_results'];
  for (const scope of scopes) {
    if (pointers.some(key => scope[key])) return true;
    if (totals.some(key => Number.isFinite(Number(scope[key])) && Number(scope[key]) > list.length))
      return true;
  }
  return false;
}

async function byListing(address, method, fetchImpl, listOf, isThere) {
  const response = await ask(address, fetchImpl);
  if (!response.ok) return unknown(method, answered(response.status));
  let data;
  try {
    data = await response.json();
  } catch {
    return unknown(method, 'The job board list could not be read.');
  }
  const list = listOf(data);
  if (!Array.isArray(list) || list.length === 0)
    return unknown(method, 'The job board list was empty or not in the expected shape.');
  if (list.some(isThere)) return open(method);
  // Absent only means gone when the whole board was read in this one answer.
  if (partialList(data, list))
    return unknown(method, 'The job board list was paged or capped, so it proves nothing.');
  return notListed(method);
}

function greenhouse(url, fetchImpl) {
  const parts = greenhouseParts(url);
  if (!parts) return null;
  return byAddress(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parts.board)}/jobs/${encodeURIComponent(parts.id)}`,
    'greenhouse',
    fetchImpl,
  );
}

function lever(url, fetchImpl) {
  const parts = leverParts(url);
  if (!parts) return null;
  return byAddress(
    `https://${parts.apiHost}/v0/postings/${encodeURIComponent(parts.board)}/${encodeURIComponent(parts.id)}?mode=json`,
    'lever',
    fetchImpl,
  );
}

function ashby(url, fetchImpl) {
  const parts = ashbyParts(url);
  if (!parts) return null;
  return byListing(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parts.board)}`,
    'ashby',
    fetchImpl,
    data => data?.jobs || data?.jobPostings,
    job => job.id === parts.id || job.jobUrl?.split(/[/?#]/).filter(Boolean).pop() === parts.id,
  );
}

function smartrecruiters(url, fetchImpl) {
  const parts = smartrecruitersParts(url);
  if (!parts) return null;
  return byAddress(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parts.company)}/postings/${encodeURIComponent(parts.id)}`,
    'smartrecruiters',
    fetchImpl,
  );
}

// Workday answers 403 for a removed posting as well as for a blocked request, so a 403 is
// settled by searching the employer's own board for the job, page by page, to the end.
async function workdayBoard(parts, fetchImpl) {
  const limit = 20;
  for (let offset = 0; offset < limit * 10; offset += limit) {
    const response = await fetchImpl(parts.search, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: parts.title }),
    });
    if (!response.ok) return unknown('workday', answered(response.status));
    let data;
    try {
      data = await response.json();
    } catch {
      return unknown('workday', 'The job board list could not be read.');
    }
    const postings = data?.jobPostings;
    if (!Array.isArray(postings)) return unknown('workday', 'The job board search was unreadable.');
    if (postings.some(job => job.externalPath?.endsWith(parts.leaf))) return open('workday');
    const total = Number.isFinite(data.total) ? data.total : null;
    const end = postings.length < limit || (total !== null && offset + limit >= total);
    if (end) {
      // A search that returned nothing at all is not proof either way.
      if (offset === 0 && postings.length === 0)
        return unknown('workday', 'The job board search returned nothing.');
      return notListed('workday');
    }
  }
  return unknown('workday', 'The job board search was too long to settle.');
}

async function workday(url, fetchImpl) {
  const parts = workdayParts(url);
  if (!parts) return null;
  const response = await ask(parts.api, fetchImpl);
  if (response.status === 403) return workdayBoard(parts, fetchImpl);
  if ([404, 410].includes(response.status)) return closed('workday', answered(response.status));
  if (!response.ok) return unknown('workday', answered(response.status));
  let info;
  try {
    info = (await response.json())?.jobPostingInfo;
  } catch {
    return unknown('workday', 'The job board answer could not be read.');
  }
  if (!info) return unknown('workday', 'The job board answer had no posting.');
  return info.canApply === false
    ? closed('workday', 'The job board says it no longer takes applications.')
    : open('workday');
}

function workable(url, fetchImpl) {
  const parts = workableParts(url);
  return parts ? byAddress(parts.api, 'workable', fetchImpl) : null;
}

// BambooHR keeps answering for a closed opening's own page, so only its list can be trusted.
function bamboohr(url, fetchImpl) {
  const parts = bamboohrParts(url);
  if (!parts) return null;
  return byListing(
    parts.list,
    'bamboohr',
    fetchImpl,
    data => data?.result,
    job => String(job.id) === parts.id,
  );
}

function breezy(url, fetchImpl) {
  const parts = breezyParts(url);
  if (!parts) return null;
  return byListing(
    parts.list,
    'breezy',
    fetchImpl,
    data => data,
    job => job.friendly_id === parts.slug || String(job.url || '').includes(`/p/${parts.slug}`),
  );
}

// Pinpoint's public postings.json is the whole board. The raw items are compared, so an item our
// provider's parser would drop (no title, non-https url) is never counted as absent.
function pinpoint(url, fetchImpl) {
  const parts = pinpointParts(url);
  if (!parts) return null;
  return byListing(
    parts.list,
    'pinpoint',
    fetchImpl,
    data => data?.data,
    job => String(job?.id ?? '') === parts.id || String(job?.url ?? '').includes(parts.id),
  );
}

const TILE_PAGE =
  /job-tile|jobs-list|search-results|searchResults|no (?:open )?(?:jobs|positions|results)/i;

// SuccessFactors: read the board's tile list to its end; unreadable or capped means unknown.
async function successfactors(url, fetchImpl) {
  const parts = successfactorsParts(url);
  if (!parts) return null;
  const seen = new Set();
  const maxPages = 40;
  let startrow = 0;
  for (let page = 0; page < maxPages; page++) {
    const response = await ask(
      `${parts.base}/tile-search-results/?startrow=${startrow}`,
      fetchImpl,
      PAGE_HEADERS,
    );
    if (!response.ok) return unknown('successfactors', answered(response.status));
    const html = await response.text();
    const rows = parseSuccessFactorsTiles(html, parts.origin);
    if (rows.some(row => row.id === parts.id)) return open('successfactors');
    // A later page with no tiles ends the list only if it is a real tile page; a throttle or
    // "verify your request" page is not an end, so the whole check is unknown.
    if (!rows.length && seen.size && !TILE_PAGE.test(html))
      return unknown('successfactors', 'A later page of the job board list was not readable.');
    const fresh = rows.filter(row => !seen.has(row.id));
    if (!fresh.length) {
      if (!seen.size) return unknown('successfactors', 'The job board list was empty.');
      return notListed('successfactors');
    }
    for (const row of fresh) seen.add(row.id);
    startrow += rows.length;
  }
  return unknown('successfactors', 'The job board list was too long to read to the end.');
}

// Himalayas answers 403 to its own posting pages, so its public search API is asked instead.
// Found in the results is open. Search is fuzzy, so absence proves nothing: unknown, never closed.
async function himalayas(url, fetchImpl) {
  const parts = himalayasParts(url);
  if (!parts) return null;
  const response = await ask(
    `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(parts.query)}&sort=recent`,
    fetchImpl,
  );
  if (!response.ok) return unknown('himalayas', answered(response.status));
  let data;
  try {
    data = await response.json();
  } catch {
    return unknown('himalayas', 'The job board list could not be read.');
  }
  const found = (Array.isArray(data?.jobs) ? data.jobs : []).some(job =>
    [job.guid, job.applicationLink].some(link => String(link || '').includes(parts.slug)),
  );
  return found
    ? open('himalayas')
    : unknown('himalayas', 'The posting was not in the search results, which proves nothing.');
}

const API_CHECKS = [
  himalayas,
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  workable,
  bamboohr,
  breezy,
  pinpoint,
  successfactors,
];

// ---- Sites with no job-board API -------------------------------------------------------------

const CHALLENGE =
  /just a moment|cf-chl|captcha|verify you are human|access denied|px-captcha|attention required|enable javascript and cookies/i;
// Statements that the posting is closed now: perfect or negative forms only.
const CLOSURE = new RegExp(
  [
    'no longer accepting applications',
    '(?:this|the) (?:job|position|posting|role|vacancy) (?:has been|was) (?:closed|filled|removed|cancelled|canceled|expired)',
    '(?:this|the) (?:job|position|posting|role|vacancy) has (?:closed|expired)',
    '(?:this|the) (?:job|position|posting|role|vacancy) is no longer (?:available|open)',
    '(?:this|the) (?:job|position|role) is not available',
    'applications? (?:for this (?:job|position|role) )?(?:are|is) (?:now )?closed',
  ].join('|'),
  'gi',
);
// A bare "is closed/filled/expired" counts only as a whole sentence of its own.
const BARE_CLOSURE =
  /(?:this|the) (?:job|position|posting|role|vacancy) is (?:closed|filled|expired)\b/gi;
// A condition ("until the position is filled") is not a statement that the posting is closed.
const CONDITION = /\b(?:until|once|when|after|if|unless|before|as soon as)\b/i;

function sentenceLead(text, index) {
  const before = text.slice(0, index);
  const cut = Math.max(...['.', '!', '?', ':', ';'].map(mark => before.lastIndexOf(mark)));
  return before.slice(cut + 1);
}

/** The first closure phrase in visible text, or null. */
export function closurePhrase(text) {
  for (const [pattern, bare] of [
    [CLOSURE, false],
    [BARE_CLOSURE, true],
  ]) {
    for (const match of text.matchAll(pattern)) {
      const lead = sentenceLead(text, match.index);
      if (bare && lead.trim() !== '') continue;
      if (CONDITION.test(lead.slice(-40))) continue;
      // What follows in the same sentence: a qualified statement ("closed to candidates...",
      // "no longer open to remote...") is not a notice, and a bare form must end its sentence.
      const tail = text.slice(match.index + match[0].length).split(/[.!?]/)[0];
      if (bare ? tail.trim() !== '' : /^\s+(?:from|to|on|for)\s+\S/i.test(tail)) continue;
      return match[0];
    }
  }
  return null;
}

/**
 * Where a site puts a closure notice: the page title, the first headings and the opening 300
 * characters of the main text (script, style, nav, header and footer removed). Never the body of
 * the description.
 */
export function noticeSegments(html) {
  const source = String(html);
  const main = source.replace(
    /<(script|style|noscript|nav|header|footer|select|option)\b[\s\S]*?<\/\1>/gi,
    ' ',
  );
  const plain = fragment =>
    fragment
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const segments = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  if (title) segments.push(plain(title[1]));
  for (const heading of [...main.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].slice(0, 3))
    segments.push(plain(heading[1]));
  segments.push(plain(main).slice(0, 300));
  return segments.filter(Boolean);
}

const visibleText = html =>
  String(html)
    .replace(/<(script|style|noscript|nav|header|footer|select|option)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

function jobPostings(html) {
  const found = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    const type = value['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting')))
      found.push(value);
    if (value['@graph']) walk(value['@graph']);
  };
  for (const match of String(html).matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1]));
    } catch {
      // Not readable structured data.
    }
  }
  return found;
}

const expired = (html, now) =>
  jobPostings(html).some(job => {
    const at = Date.parse(job.validThrough || job.validUntil || '');
    return Number.isFinite(at) && at < now;
  });

function jobToken(url) {
  for (const key of ['gh_jid', 'jid', 'jobId', 'job_id', 'id', 'job', 'req', 'requisitionId']) {
    const value = url.searchParams.get(key);
    if (value) return value;
  }
  const leaf = url.pathname.split('/').filter(Boolean).pop() || '';
  return /\d{3,}/.test(leaf) ? leaf : null;
}

/** Positive signs of closure in a rendered page; null when there are none. */
export function closureSigns({ url, finalUrl, html, now = Date.now() }) {
  if (expired(html, now)) return 'The structured job data shows a passed expiry date.';
  const phrase = noticeSegments(html).map(closurePhrase).find(Boolean);
  if (phrase) return `The page says: "${phrase}".`;
  if (finalUrl) {
    const token = jobToken(url);
    if (token && !finalUrl.toLowerCase().includes(token.toLowerCase()))
      return 'The address no longer carries the job ID.';
  }
  return null;
}

async function plainPage(url, fetchImpl, { renderPage, now }) {
  const response = await ask(url.href, fetchImpl, PAGE_HEADERS);
  if ([404, 410].includes(response.status)) return closed('page', answered(response.status));
  if (!response.ok) return unknown('page', answered(response.status));
  const html = await response.text();
  if (html.length < 20000 && CHALLENGE.test(visibleText(html)))
    return unknown('page', 'The site answered with a challenge page.');
  // The same positive signs as the rendered step: a closure phrase or a passed expiry date.
  // (The plain request does not expose a final address, so that sign is rendered-only.)
  const plainSign = closureSigns({ url, finalUrl: null, html, now });
  if (plainSign) return probablyClosed('page', plainSign);
  if (extractDescriptionFromHtml(html)) return open('page');
  if (!renderPage) return unknown('page', 'The page has no job content to read.');
  const rendered = await renderPage(url.href);
  if (rendered?.slowDown) return unknown('render', SLOW_DOWN);
  if (!rendered?.html) return unknown('render', 'The page could not be rendered.');
  if (rendered.html.length < 20000 && CHALLENGE.test(visibleText(rendered.html)))
    return unknown('render', 'The site answered with a challenge page.');
  const sign = closureSigns({ url, finalUrl: rendered.finalUrl, html: rendered.html, now });
  if (sign) return probablyClosed('render', sign);
  return extractDescriptionFromHtml(rendered.html)
    ? open('render')
    : unknown('render', 'The rendered page has no job content to read.');
}

/**
 * Check one saved link. fetchImpl and renderPage are injectable; renderPage(url) returns
 * { finalUrl, html } or null and is the only step that may launch a browser.
 */
export async function checkPosting(
  rawUrl,
  { fetchImpl = requestWithTimeout, renderPage = null, now = Date.now() } = {},
) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return unknown('', 'This job has no usable link.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    return unknown('', 'This job has no usable link.');
  const skipped = neverRequested(url);
  if (skipped) return unknown('not-checked', skipped);
  try {
    for (const check of API_CHECKS) {
      const result = await check(url, fetchImpl);
      if (result) return result;
    }
    return await plainPage(url, fetchImpl, { renderPage, now });
  } catch (error) {
    if (error instanceof SlowDownError) return unknown('', SLOW_DOWN);
    return unknown(
      '',
      `The check could not finish: ${String(error?.message || error).slice(0, 120)}`,
    );
  }
}

// ---- Concurrency -----------------------------------------------------------------------------

/**
 * Wraps fetchImpl so at most `concurrency` requests run at once and `perHost` per host. Once a
 * host answers 429 no further request goes to it (`.slowed` holds those hosts); the rest of its
 * jobs are unknown.
 */
export function limitFetch(fetchImpl, { concurrency = 8, perHost = 2 } = {}) {
  let active = 0;
  const hosts = new Map();
  const waiting = [];
  const slowed = new Set();
  const free = host => active < concurrency && (hosts.get(host) || 0) < perHost;
  const pump = () => {
    for (let i = 0; i < waiting.length; i++) {
      const item = waiting[i];
      if (slowed.has(item.host)) {
        waiting.splice(i--, 1);
        item.reject(new SlowDownError());
        continue;
      }
      if (!free(item.host)) continue;
      waiting.splice(i--, 1);
      active++;
      hosts.set(item.host, (hosts.get(item.host) || 0) + 1);
      Promise.resolve()
        .then(() => fetchImpl(item.url, item.options))
        .then(response => {
          if (response?.status === 429) slowed.add(item.host);
          item.resolve(response);
        }, item.reject)
        .finally(() => {
          active--;
          hosts.set(item.host, hosts.get(item.host) - 1);
          pump();
        });
    }
  };
  const limited = (url, options) =>
    new Promise((resolve, reject) => {
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        // The request itself will fail.
      }
      waiting.push({ url, options, host, resolve, reject });
      pump();
    });
  limited.slowed = slowed;
  return limited;
}

async function pool(items, worker, size) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await worker(items[index]);
      }
    }),
  );
  return out;
}

/** Why a closed or probably_closed result was reached, for counting flags by reason. */
export function reasonOf(result) {
  if (result.state !== 'closed' && result.state !== 'probably_closed') return null;
  const detail = String(result.detail || '');
  if (detail.startsWith('The structured job data')) return 'expiry';
  if (detail.startsWith('The page says')) return 'phrase';
  if (detail.startsWith('The address no longer')) return 'lost-id';
  if (detail.startsWith('No longer listed')) return 'list';
  if (/no longer takes applications/.test(detail)) return 'workday-apply';
  if (/answered (404|410)\./.test(detail)) return 'http-404-410';
  return 'other';
}

// ---- Decision layer --------------------------------------------------------------------------

const CHECKED_STATUSES = ['Pending', 'Evaluated', 'Applied'];

/**
 * job: { id, status, revision, board, state, restored, activeTask }
 * Returns { actions: [{ id, action, reason, heldBack }], summary }.
 * action is 'discard' | 'flag' | 'none' | 'skip'.
 */
export function decideActions(jobs, limits = OUTAGE_LIMITS) {
  const summary = {
    checked: 0,
    open: 0,
    closed: 0,
    probablyClosed: 0,
    unknown: 0,
    skipped: 0,
    wouldDiscard: 0,
    wouldFlag: 0,
    heldBack: 0,
    heldBoards: [],
    runHeld: false,
  };
  const actions = jobs.map(job => {
    if (job.activeTask)
      return { id: job.id, action: 'skip', reason: 'A task is queued or running.' };
    if (!CHECKED_STATUSES.includes(job.status))
      return { id: job.id, action: 'skip', reason: 'This status is not checked.' };
    if (job.state === 'closed') {
      if (job.status === 'Applied')
        return { id: job.id, action: 'flag', reason: 'Applied, and the posting is closed.' };
      if (job.restored)
        return { id: job.id, action: 'flag', reason: 'Restored after an earlier expiry.' };
      return { id: job.id, action: 'discard', reason: REASON };
    }
    if (job.state === 'probably_closed')
      return { id: job.id, action: 'flag', reason: 'The page shows signs of closure.' };
    return { id: job.id, action: 'none', reason: '' };
  });

  const counted = jobs.filter((_, i) => actions[i].action !== 'skip');
  summary.skipped = jobs.length - counted.length;
  summary.checked = counted.length;
  for (const job of counted) {
    if (job.state === 'open') summary.open++;
    else if (job.state === 'closed') summary.closed++;
    else if (job.state === 'probably_closed') summary.probablyClosed++;
    else summary.unknown++;
  }

  const over = (closedCount, total, { share, min }) =>
    closedCount >= min && closedCount > total * share;
  const perBoard = new Map();
  for (const job of counted) {
    const entry = perBoard.get(job.board) || { total: 0, closed: 0 };
    entry.total++;
    if (job.state === 'closed') entry.closed++;
    perBoard.set(job.board, entry);
  }
  // Beside the share limit: a board with two or more checked jobs that all closed in the same run
  // looks like a vendor switch or an outage, whatever its size.
  const heldBoards = new Set(
    [...perBoard]
      .filter(
        ([, e]) => over(e.closed, e.total, limits.board) || (e.total >= 2 && e.closed === e.total),
      )
      .map(([board]) => board),
  );
  summary.heldBoards = [...heldBoards];
  summary.runHeld = over(summary.closed, summary.checked, limits.run);

  jobs.forEach((job, i) => {
    const action = actions[i];
    if (action.action === 'discard' && (summary.runHeld || heldBoards.has(job.board))) {
      action.action = 'flag';
      action.heldBack = true;
      action.reason = summary.runHeld
        ? 'Held back: too many postings closed in this run.'
        : 'Held back: too many postings closed on this employer board.';
      summary.heldBack++;
    }
    if (action.action === 'discard') summary.wouldDiscard++;
    if (action.action === 'flag') summary.wouldFlag++;
  });
  return { actions, summary };
}

// ---- Runner and CLI --------------------------------------------------------------------------

/**
 * loadJobs(id|null) -> [{ id, url, status, revision, restored, activeTask }]
 * write: { recordCheck(job, result, storedAction), discard(job) -> 'discarded' | 'conflict' }
 */
export async function runLiveness({
  loadJobs,
  id = null,
  dryRun = false,
  write = null,
  fetchImpl = requestWithTimeout,
  renderPage = null,
  log = console.log,
  limits = OUTAGE_LIMITS,
  concurrency = { concurrency: 8, perHost: 2 },
}) {
  if (!dryRun && !(write?.recordCheck && write?.discard))
    throw new Error('Writing checks needs the database writers; pass --dry-run to change nothing.');
  const jobs = await loadJobs(id);
  if (id && !jobs.length)
    throw new Error(`Job #${id} is not checked (missing, or not Pending, Evaluated or Applied).`);
  const limited = limitFetch(fetchImpl, concurrency);
  // The renderer obeys the same rule: a host that said 429 is not rendered again this run.
  const render =
    renderPage &&
    (async address => {
      const host = new URL(address).hostname;
      if (limited.slowed.has(host)) return { slowDown: true };
      const page = await renderPage(address);
      if (page?.slowDown) limited.slowed.add(host);
      return page;
    });
  const results = await pool(
    jobs,
    async job => {
      try {
        return await checkPosting(job.url, { fetchImpl: limited, renderPage: render });
      } catch (error) {
        return unknown('', `The check did not finish: ${error.message}`);
      }
    },
    24,
  );
  const decided = decideActions(
    jobs.map((job, i) => ({ ...job, board: boardKey(job.url), state: results[i].state })),
    limits,
  );
  let discarded = 0;
  let conflicts = 0;
  let failed = 0;
  let late = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const result = results[i];
    const action = decided.actions[i];
    log(
      `#${job.id} ${result.state}${reasonOf(result) ? ' [' + reasonOf(result) + ']' : ''} (${action.action}${action.heldBack ? ', held back' : ''})${result.detail ? ' | ' + result.detail : ''}`,
    );
    if (dryRun || action.action === 'skip') continue;
    let stored = storedAction(action);
    let recorded = result;
    if (action.action === 'discard') {
      // Discards come at the end of a long run: a task that started since the jobs were read
      // (or a status that changed) leaves the job for the next check.
      const fresh = (await loadJobs(job.id)).find(row => row.id === job.id);
      if (!fresh || fresh.activeTask) {
        late++;
        stored = 'none';
        recorded = {
          ...result,
          detail: `${result.detail} A task started; left for the next check.`.trim(),
        };
      } else {
        try {
          if ((await write.discard(job)) === 'discarded') {
            discarded++;
            stored = 'discarded';
          } else {
            // Changed since it was read: left for the next check.
            conflicts++;
            stored = 'none';
          }
        } catch (error) {
          failed++;
          stored = 'none';
          recorded = { ...result, detail: `${result.detail} The discard failed.`.trim() };
          log(`#${job.id} discard failed: ${String(error?.message || error).slice(0, 80)}`);
        }
      }
    }
    await write.recordCheck(job, recorded, stored);
  }
  const s = decided.summary;
  const reasons = {};
  for (const result of results) {
    const reason = reasonOf(result);
    if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
  }
  if (Object.keys(reasons).length)
    log(
      `Closed or probably closed by reason: ${Object.entries(reasons)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(', ')}.`,
    );
  log(
    `\nChecked ${s.checked}: ${s.open} open, ${s.closed} closed, ${s.probablyClosed} probably closed, ${s.unknown} unknown` +
      (s.skipped ? `, ${s.skipped} skipped (task active)` : '') +
      `.\nWould discard ${s.wouldDiscard}, would flag ${s.wouldFlag}, held back by an outage limit ${s.heldBack}` +
      (s.runHeld
        ? ' (whole run)'
        : s.heldBoards.length
          ? ` (boards: ${s.heldBoards.join(', ')})`
          : '') +
      '.' +
      (dryRun
        ? ' Dry run: nothing written.'
        : ` Discarded ${discarded}, conflicts ${conflicts}, failed ${failed}, task started ${late}.`),
  );
  return { ...decided, reasons, discarded, conflicts, discardFailed: failed, startedLate: late };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const id = args.find(arg => arg.startsWith('--job='))?.slice('--job='.length) || null;
  if (Boolean(id) === all || (id && !/^\d+$/.test(id)))
    throw new Error('Usage: node src/scan/liveness.mjs --job=ID | --all [--dry-run]');
  const { query, close } = await import('../lib/_database.mjs');
  const renderer = createRenderer();
  try {
    await runLiveness({
      id,
      dryRun,
      loadJobs: jobId => loadEligibleJobs(query, jobId),
      write: dryRun ? null : createLivenessWriter(query),
      renderPage: renderer.renderPage,
    });
  } finally {
    await renderer.close();
    await close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Fatal:', error.message);
    process.exit(1);
  });
}
