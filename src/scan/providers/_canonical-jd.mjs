/**
 * Full-JD resolver for aggregator results.
 *
 * hiring.cafe supplies the employer's canonical apply URL. Fetching that
 * public posting (or its ATS posting API) is faster and more stable than
 * opening hiring.cafe's protected detail page once per result.
 */

import { htmlToText, requestWithTimeout } from './_http.mjs';

const MIN_DESCRIPTION_LENGTH = 300;
const MAX_ATTEMPTS = 3;
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function cleanDescription(value) {
  if (typeof value !== 'string') return null;
  const text = htmlToText(value)
    .replace(/\u0000/g, '')
    .trim();
  return text.length >= MIN_DESCRIPTION_LENGTH ? text : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 15000);
  return 400 * 2 ** attempt;
}

async function request(
  url,
  {
    fetchImpl = requestWithTimeout,
    accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { ...DEFAULT_HEADERS, Accept: accept },
      });
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(400 * 2 ** attempt);
      continue;
    }

    if (response.ok) return response;
    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    await sleep(retryDelay(response, attempt));
  }
  throw lastError || new Error('request failed');
}

async function requestJson(url, options) {
  const response = await request(url, { ...options, accept: 'application/json' });
  return response.json();
}

function walkJson(value, candidates, depth = 0) {
  if (!value || depth > 20) return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, candidates, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  const type = value['@type'];
  const isJobPosting =
    type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
  if (isJobPosting) {
    const text = cleanDescription(value.description);
    if (text) candidates.push({ text, score: 100 });
  }

  const descriptionKeys = new Map([
    ['jobdescription', 80],
    ['jobdescriptionhtml', 80],
    ['externaldescription', 75],
    ['descriptionhtml', 70],
    ['description_raw', 70],
    ['description_clean', 70],
    ['description', 50],
  ]);

  for (const [key, child] of Object.entries(value)) {
    const score = descriptionKeys.get(key.toLowerCase());
    if (score && typeof child === 'string') {
      const text = cleanDescription(child);
      if (text) candidates.push({ text, score });
    }
    if (child && typeof child === 'object') walkJson(child, candidates, depth + 1);
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractElementInnerHtml(html, attributePattern) {
  const opening = new RegExp(`<([a-z][a-z0-9:-]*)\\b[^>]*${attributePattern}[^>]*>`, 'i').exec(
    html,
  );
  if (!opening) return null;
  const tag = opening[1];
  const contentStart = opening.index + opening[0].length;
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  tags.lastIndex = contentStart;
  let depth = 1;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    const closing = /^<\//.test(match[0]);
    const selfClosing = /\/>$/.test(match[0]);
    if (closing) depth--;
    else if (!selfClosing) depth++;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  return null;
}

export function extractDescriptionFromHtml(html) {
  if (!html) return null;
  const candidates = [];
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    const attrs = match[1] || '';
    const raw = (match[2] || '').trim();
    if (!raw) continue;
    const looksStructured =
      /application\/(?:ld\+)?json/i.test(attrs) || /id=["']__NEXT_DATA__["']/i.test(attrs);
    if (!looksStructured) continue;
    const data = parseJson(raw);
    if (data) walkJson(data, candidates);
  }
  const microdata = extractElementInnerHtml(html, `itemprop=["']description["']`);
  const microdataText = cleanDescription(microdata);
  if (microdataText) candidates.push({ text: microdataText, score: 90 });

  const jobDescriptionElement = extractElementInnerHtml(
    html,
    `(?:class=["'][^"']*jobdescription[^"']*["']|data-careersite-propertyid=["']description["'])`,
  );
  const elementText = cleanDescription(jobDescriptionElement);
  if (elementText) candidates.push({ text: elementText, score: 65 });

  candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  return candidates[0]?.text || null;
}

export function extractEmbeddedDescription(hit) {
  const values = [
    hit?.job_information?.description,
    hit?.description_raw,
    hit?.description_clean,
    hit?.job_description,
  ];
  const descriptions = values.map(cleanDescription).filter(Boolean);
  descriptions.sort((a, b) => b.length - a.length);
  return descriptions[0] || null;
}

function greenhouseParts(url) {
  if (!/greenhouse\.io$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const jobsIndex = parts.indexOf('jobs');
  const board = url.searchParams.get('for') || (jobsIndex > 0 ? parts[jobsIndex - 1] : parts[0]);
  const id =
    url.searchParams.get('token') ||
    url.searchParams.get('gh_jid') ||
    (jobsIndex >= 0 ? parts[jobsIndex + 1] : null);
  return board && id ? { board, id: id.split('?')[0] } : null;
}

async function fetchGreenhouse(url, options) {
  const parts = greenhouseParts(url);
  if (!parts) return null;
  const data = await requestJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parts.board)}/jobs/${encodeURIComponent(parts.id)}`,
    options,
  );
  return cleanDescription(data?.content);
}

async function fetchLever(url, options) {
  if (!/(^|\.)lever\.co$/i.test(url.hostname)) return null;
  const [board, id] = url.pathname.split('/').filter(Boolean);
  if (!board || !id) return null;
  const apiHost = url.hostname.startsWith('jobs.eu.') ? 'api.eu.lever.co' : 'api.lever.co';
  const data = await requestJson(
    `https://${apiHost}/v0/postings/${encodeURIComponent(board)}/${encodeURIComponent(id)}?mode=json`,
    options,
  );
  const sections = [
    data?.descriptionPlain || data?.description,
    ...(data?.lists || []).flatMap(section => [section?.text, section?.content]),
    data?.additionalPlain || data?.additional,
  ]
    .filter(Boolean)
    .join('\n\n');
  return cleanDescription(sections);
}

async function fetchAshby(url, options) {
  if (url.hostname !== 'jobs.ashbyhq.com') return null;
  const [board, id] = url.pathname.split('/').filter(Boolean);
  if (!board || !id) return null;
  const data = await requestJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
    options,
  );
  const job = (data?.jobs || data?.jobPostings || []).find(
    item => item.id === id || item.jobUrl?.split(/[/?#]/).filter(Boolean).pop() === id,
  );
  return cleanDescription(job?.descriptionHtml || job?.description);
}

async function fetchSmartRecruiters(url, options) {
  if (!/(^|\.)smartrecruiters\.com$/i.test(url.hostname)) return null;
  const [company, postingSlug] = url.pathname.split('/').filter(Boolean);
  if (!company || !postingSlug) return null;
  const postingId = postingSlug.split('-')[0];
  const data = await requestJson(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(postingId)}`,
    options,
  );
  const sections = data?.jobAd?.sections || {};
  const content = Object.values(sections)
    .flatMap(section => {
      if (typeof section === 'string') return [section];
      if (Array.isArray(section))
        return section.map(item => item?.text || item?.description || '').filter(Boolean);
      return [section?.text || section?.description || ''].filter(Boolean);
    })
    .join('\n\n');
  return cleanDescription(content);
}

async function fetchWorkday(url, options) {
  if (!/\.myworkdayjobs\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const jobIndex = parts.indexOf('job');
  if (jobIndex < 1) return null;
  const site = parts[jobIndex - 1];
  const tenant = url.hostname.split('.')[0];
  const externalPath = `/${parts.slice(jobIndex).join('/')}`;
  const data = await requestJson(
    `${url.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${externalPath}`,
    options,
  );
  return cleanDescription(data?.jobPostingInfo?.jobDescription);
}

const ATS_FETCHERS = [fetchGreenhouse, fetchLever, fetchAshby, fetchSmartRecruiters, fetchWorkday];

export async function fetchCanonicalJobDescription(hit, { fetchImpl = requestWithTimeout } = {}) {
  const embedded = extractEmbeddedDescription(hit);
  if (embedded) return { text: embedded, method: 'search-hit' };

  const applyUrl = hit?.apply_url || hit?.hc_apply_url;
  if (!applyUrl) return null;

  let url;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  if (
    url.hostname === 'hiring.cafe' ||
    url.hostname === 'hiringcafe.com' ||
    url.hostname.endsWith('.hiringcafe.com')
  )
    return null;

  for (const fetcher of ATS_FETCHERS) {
    try {
      const text = await fetcher(url, { fetchImpl });
      if (text) return { text, method: fetcher.name.replace(/^fetch/, '').toLowerCase() };
    } catch {
      // The employer page below is the cross-ATS fallback.
    }
  }

  try {
    const response = await request(url.href, { fetchImpl });
    const text = extractDescriptionFromHtml(await response.text());
    return text ? { text, method: 'canonical-json' } : null;
  } catch {
    return null;
  }
}

/**
 * Rendered fallback for public careers pages whose JD is populated by
 * JavaScript. Callers share one browser and keep concurrency low.
 */
export async function fetchRenderedCanonicalJobDescription(applyUrl, browser) {
  let url;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  if (
    url.hostname === 'hiring.cafe' ||
    url.hostname === 'hiringcafe.com' ||
    url.hostname.endsWith('.hiringcafe.com')
  )
    return null;

  const context = await browser.newContext({
    userAgent: DEFAULT_HEADERS['User-Agent'],
    locale: 'en-CA',
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok()) return null;
    await page.waitForTimeout(1200);

    const structured = extractDescriptionFromHtml(await page.content());
    if (structured) return { text: structured, method: 'rendered-structured' };

    const selectors = [
      '[data-automation-id="jobPostingDescription"]',
      '[data-careersite-propertyid="description"]',
      '[itemprop="description"]',
      '#jobdescription',
      '#job-description',
      '.jobdescription',
      '.job-description',
      '.BambooHR-ATS-Description',
      '[class*="JobDescription"]',
      '[class*="jobDescription"]',
      '[class*="job-description"]',
      '[id*="jobDescription"]',
    ];
    const candidates = [];
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector);
        const count = Math.min(await locator.count().catch(() => 0), 5);
        for (let index = 0; index < count; index++) {
          const raw = await locator
            .nth(index)
            .innerText({ timeout: 1500 })
            .catch(() => '');
          const text = cleanDescription(raw);
          if (text) candidates.push(text);
        }
      }
    }
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] ? { text: candidates[0], method: 'rendered-dom' } : null;
  } finally {
    await context.close();
  }
}

export async function mapWithHostLimits(items, mapper, { concurrency = 8, perHost = 2 } = {}) {
  const output = new Array(items.length);
  const queues = new Map();
  for (let index = 0; index < items.length; index++) {
    let host = 'unknown';
    try {
      host = new URL(items[index]?.apply_url || items[index]?.url || '').hostname || host;
    } catch {
      /* keep unknown */
    }
    if (!queues.has(host)) queues.set(host, []);
    queues.get(host).push(index);
  }

  const activeHosts = new Map();
  let active = 0;
  let remaining = items.length;

  return new Promise(resolve => {
    if (remaining === 0) return resolve(output);
    const pump = () => {
      if (remaining === 0) return resolve(output);
      if (active >= concurrency) return;

      let scheduled = false;
      for (const [host, queue] of queues) {
        if (active >= concurrency) break;
        if (queue.length === 0 || (activeHosts.get(host) || 0) >= perHost) continue;
        const index = queue.shift();
        active++;
        activeHosts.set(host, (activeHosts.get(host) || 0) + 1);
        scheduled = true;
        Promise.resolve(mapper(items[index], index))
          .then(value => {
            output[index] = value;
          })
          .catch(() => {
            output[index] = null;
          })
          .finally(() => {
            active--;
            remaining--;
            activeHosts.set(host, activeHosts.get(host) - 1);
            pump();
          });
      }
      if (scheduled && active < concurrency) pump();
    };
    pump();
  });
}
