import { readFile } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { root as repositoryRoot } from '../lib/root.mjs';
import { normalizeUrl } from '../scan/add-pasted-jd.mjs';
import {
  fetchAtsJobPosting,
  fetchCanonicalJobDescription,
} from '../scan/providers/_canonical-jd.mjs';
import { createIntakeExtractor } from './intake-extract.mjs';
import { htmlToText, requestWithTimeout } from '../scan/providers/_http.mjs';

// URL intake fetch (package 4.6, D080). Given a posting URL, return company, role, location and
// the full JD text so the owner can review the form and press Add. Nothing is inserted here and
// it is called at intake only, never during evaluation or drafting.
//
// Order: (1) validate the URL, refusing loopback, private and link-local targets; (2) the
// scanner's resolver, read-only, plus the page's JSON-LD JobPosting for the three fields;
// (3) Firecrawl when the resolver gave no text or no company/role, or the host is one that
// blocks plain fetches; (4) empty result is 422, a Firecrawl HTTP failure is 502.
//
// Firecrawl API pinned to v2 (checked against https://docs.firecrawl.dev on 2026-11-11):
//   POST https://api.firecrawl.dev/v2/scrape        Authorization: Bearer <key>
//   body  { url, formats: ['markdown'], onlyMainContent, timeout }
//   reply { success, data: { markdown, metadata: { statusCode, ... } } }
// Markdown only: one scrape call is one credit. Company, role, location and the cleaned posting
// text come from the extraction step (intake-extract.mjs), not from Firecrawl.
// The key comes from FIRECRAWL_API_KEY or config/firecrawl.json, is read per request, and appears
// only in the Authorization header. Only the posting URL is sent to Firecrawl.

export const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';
const MAX_URL = 2048;
const MAX_FIELD = 300;
const MAX_TEXT_BYTES = 1024 * 1024;
const RESOLVER_BUDGET_MS = 20_000;
const FIRECRAWL_SCRAPE_MS = 30_000;
const FIRECRAWL_GRACE_MS = 5_000;
const MAX_HTML = 4 * 1024 * 1024;
const FIRECRAWL_HOSTS = ['linkedin.com', 'indeed.com', 'glassdoor.com'];
// AGENTS.md hiring.cafe contract: its pages are never fetched here, by us or by proxy.
const REFUSED_HOSTS = ['hiring.cafe', 'hiringcafe.com'];
const NOT_CONFIGURED =
  'Firecrawl is not configured; add config/firecrawl.json to fetch LinkedIn and Indeed postings.';
const INVALID_CONFIG =
  'config/firecrawl.json is not valid; expected {"version": 1, "apiKey": "..."}.';
// Methods whose text and fields come straight from an ATS's own JSON; they skip the model step.
const ATS_METHODS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday'];
const EMPTY_FIELDS = { company: null, role: null, location: null };

function publicError(statusCode, publicCode, message, fields, retryable = false) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  error.retryable = retryable;
  if (fields) error.fields = fields;
  return error;
}

const invalidUrl = message =>
  publicError(400, 'INVALID_REQUEST', message ?? 'Request field is invalid.', {
    url: 'Invalid value.',
  });

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const value = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
    if (hexMapped) {
      const high = parseInt(hexMapped[1], 16);
      const low = parseInt(hexMapped[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return (
      value === '::' ||
      value === '::1' ||
      /^f[cd]/.test(value) ||
      /^fe[89ab]/.test(value) ||
      value.startsWith('ff')
    );
  }
  return true;
}

const hostMatches = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);

function clean(value) {
  if (typeof value !== 'string') return null;
  const text = htmlToText(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return [...text].slice(0, MAX_FIELD).join('');
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern =
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Ignore malformed blocks; the next one may be fine.
    }
  }
  return blocks;
}

function findJobPosting(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const type = value['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return value;
  return findJobPosting(value['@graph'], depth + 1);
}

const countryName = country =>
  typeof country === 'string' ? country : typeof country?.name === 'string' ? country.name : null;

function locationText(posting) {
  const places = [];
  for (const place of [posting.jobLocation].flat().filter(Boolean)) {
    if (typeof place === 'string') {
      places.push(place);
      continue;
    }
    const address = place.address;
    if (typeof address === 'string') {
      places.push(address);
      continue;
    }
    const parts = [
      address?.addressLocality,
      address?.addressRegion,
      countryName(address?.addressCountry),
    ]
      .map(clean)
      .filter(Boolean);
    if (parts.length) places.push(parts.join(', '));
    else if (typeof place.name === 'string') places.push(place.name);
  }
  const unique = [...new Set(places.map(clean).filter(Boolean))];
  if (String(posting.jobLocationType ?? '').toUpperCase() === 'TELECOMMUTE') unique.push('Remote');
  return unique.length ? unique.join('; ').slice(0, MAX_FIELD) : null;
}

// Company, role and location from a JSON-LD JobPosting block, or nulls.
export function extractJobFields(html) {
  for (const block of jsonLdBlocks(String(html ?? ''))) {
    const posting = findJobPosting(block);
    if (!posting) continue;
    const org = posting.hiringOrganization;
    return {
      company: clean(typeof org === 'string' ? org : org?.name),
      role: clean(posting.title),
      location: locationText(posting),
    };
  }
  return { ...EMPTY_FIELDS };
}

function capText(value, warnings) {
  if (typeof value !== 'string') return null;
  let text = value.replace(/\u0000/g, '').trim();
  if (!text) return null;
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    text = Buffer.from(text, 'utf8')
      .subarray(0, MAX_TEXT_BYTES)
      .toString('utf8')
      .replace(/�+$/, '');
    warnings.push('The description was longer than 1 MB and was shortened.');
  }
  return text.trim();
}

async function withBudget(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('budget')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createIntakeFetchService({
  rootDir = repositoryRoot,
  env = process.env,
  readConfig = path => readFile(path, 'utf8'),
  lookupHost = host => dnsLookup(host, { all: true }),
  atsPosting = fetchAtsJobPosting,
  extract = createIntakeExtractor({ rootDir }).extract,
  resolve = fetchCanonicalJobDescription,
  pageFetch = requestWithTimeout,
  httpFetch = (...args) => fetch(...args),
  resolverBudgetMs = RESOLVER_BUDGET_MS,
  firecrawlTimeoutMs = FIRECRAWL_SCRAPE_MS,
} = {}) {
  async function readKey(warnings) {
    const fromEnv = typeof env.FIRECRAWL_API_KEY === 'string' ? env.FIRECRAWL_API_KEY.trim() : '';
    if (fromEnv) return fromEnv;
    let raw;
    try {
      raw = await readConfig(join(rootDir, 'config', 'firecrawl.json'));
    } catch {
      warnings.push(NOT_CONFIGURED);
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      const key = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : '';
      if (parsed?.version === 1 && key) return key;
    } catch {
      // Fall through to the warning below.
    }
    warnings.push(INVALID_CONFIG);
    return null;
  }

  async function validate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw publicError(400, 'INVALID_REQUEST', 'Request body must be a JSON object.', {
        body: 'Invalid value.',
      });
    for (const key of Object.keys(body))
      if (key !== 'url')
        throw publicError(400, 'INVALID_REQUEST', 'Request field is invalid.', {
          [key]: 'Invalid value.',
        });
    if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > MAX_URL)
      throw invalidUrl();
    const normalized = normalizeUrl(body.url);
    if (!normalized) throw invalidUrl('Enter a full http or https posting address.');
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password) throw invalidUrl('The address must not hold a login.');
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const blocked = () => invalidUrl('That address points at this computer or a private network.');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local'))
      throw blocked();
    if (isIP(hostname)) {
      if (isPrivateAddress(hostname)) throw blocked();
    } else {
      let addresses;
      try {
        addresses = await lookupHost(hostname);
      } catch {
        throw invalidUrl('That address could not be found.');
      }
      if (!addresses?.length || addresses.some(item => isPrivateAddress(item.address)))
        throw blocked();
    }
    return { normalized, hostname };
  }

  async function runResolver(url) {
    const found = { text: null, method: null, fields: { ...EMPTY_FIELDS } };
    const work = (async () => {
      let ats = null;
      try {
        ats = await atsPosting(url, { fetchImpl: pageFetch });
      } catch {
        // Fall back to the generic resolver below.
      }
      if (ats?.text) {
        found.text = ats.text;
        found.method = ats.method;
        found.fields = { company: ats.company, role: ats.role, location: ats.location };
      } else {
        const resolved = await resolve({ apply_url: url }, { fetchImpl: pageFetch });
        if (resolved?.text) {
          found.text = resolved.text;
          found.method = resolved.method;
        }
      }
      if (found.fields.company && found.fields.role && found.fields.location) return;
      try {
        const response = await pageFetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        if (response?.ok) {
          const page = extractJobFields((await response.text()).slice(0, MAX_HTML));
          for (const key of Object.keys(page)) found.fields[key] ??= page[key];
        }
      } catch {
        // Fields stay null; Firecrawl may fill them.
      }
    })();
    work.catch(() => {});
    try {
      await withBudget(work, resolverBudgetMs);
    } catch {
      // Budget or resolver failure: whatever was found so far stands.
    }
    return found;
  }

  async function runFirecrawl(url, key) {
    const failed = reason =>
      publicError(
        502,
        'INTAKE_FETCH_FAILED',
        `Firecrawl fetch failed: ${reason}.`,
        undefined,
        true,
      );
    let response;
    try {
      response = await httpFetch(FIRECRAWL_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          timeout: firecrawlTimeoutMs,
        }),
        signal: AbortSignal.timeout(firecrawlTimeoutMs + FIRECRAWL_GRACE_MS),
      });
    } catch {
      throw failed('the request timed out or could not connect');
    }
    const status = response.status;
    if (status === 401) throw failed('the API key was rejected (HTTP 401)');
    if (status === 402) throw failed('the account is out of credits (HTTP 402)');
    if (status === 429) throw failed('rate limited (HTTP 429), try again shortly');
    if (!response.ok) throw failed(`HTTP ${status}`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw failed('the reply was not readable');
    }
    if (!payload?.success || !payload.data) throw failed('the scrape did not succeed');
    const data = payload.data;
    return {
      markdown: typeof data.markdown === 'string' ? data.markdown : null,
      pageStatus: Number.isInteger(data.metadata?.statusCode) ? data.metadata.statusCode : null,
    };
  }

  async function fetchPosting(body) {
    const { normalized, hostname } = await validate(body);
    if (REFUSED_HOSTS.some(domain => hostMatches(hostname, domain)))
      throw publicError(
        422,
        'INTAKE_FETCH_EMPTY',
        "hiring.cafe pages are not fetched; use the employer's apply link or paste the description.",
      );
    const warnings = [];
    const excluded = FIRECRAWL_HOSTS.some(domain => hostMatches(hostname, domain));

    let resolver = { text: null, method: null, fields: { ...EMPTY_FIELDS } };
    if (!excluded) resolver = await runResolver(normalized);

    const result = {
      url: normalized,
      company: resolver.fields.company,
      role: resolver.fields.role,
      location: resolver.fields.location,
      text: capText(resolver.text, warnings),
      source: 'resolver',
      method: resolver.method ?? 'canonical-json',
      warnings,
    };

    if (excluded || !result.text) {
      const key = await readKey(warnings);
      if (key) {
        const scraped = await runFirecrawl(normalized, key);
        if (scraped.pageStatus && scraped.pageStatus >= 400 && !scraped.markdown)
          warnings.push(`The page answered HTTP ${scraped.pageStatus}.`);
        const text = result.text ? null : capText(scraped.markdown, warnings);
        if (text) {
          result.text = text;
          result.source = 'firecrawl';
          result.method = 'firecrawl-scrape';
        }
      }
    }

    if (!result.text) {
      const hint = warnings.find(item => item === NOT_CONFIGURED || item === INVALID_CONFIG);
      throw publicError(
        422,
        'INTAKE_FETCH_EMPTY',
        `Nothing readable at that address; paste the description.${hint ? ` ${hint}` : ''}`,
      );
    }
    // Cleanup by one cheap model call, for every source except a known ATS's own JSON.
    if (!ATS_METHODS.includes(result.method)) {
      const extracted = await extract(result.text);
      if (extracted?.ok) {
        result.company ??= extracted.company;
        result.role ??= extracted.role;
        result.location ??= extracted.location;
        result.text = capText(extracted.description, warnings) ?? result.text;
        result.method = `${result.method}+llm`;
        if (extracted.note) warnings.push(extracted.note);
      } else if (extracted?.warning) warnings.push(extracted.warning);
    }
    return result;
  }

  return Object.freeze({ fetch: fetchPosting });
}
