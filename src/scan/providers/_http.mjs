/**
 * _http.mjs — Shared HTTP context factory + HTML-to-text helper for scan.mjs providers.
 * Files prefixed _ are helpers, not providers, and are skipped by the loader.
 *
 * makeHttpCtx() returns { get(url), getJson(url), postJson(url, body) }.
 * All requests carry a browser-like User-Agent to avoid bot-blocking.
 */

import http from 'node:http';
import https from 'node:https';

// Some sources double-encode (e.g. a literal "&amp;amp;" for what should be "&"),
// so unescape repeatedly until a pass makes no further change (bounded to be safe).
function unescapeEntities(s) {
  for (let i = 0; i < 5; i++) {
    const next = s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#([0-9]+);/g, (_match, decimal) =>
        String.fromCodePoint(Number.parseInt(decimal, 10)),
      );
    if (next === s) return next;
    s = next;
  }
  return s;
}

// Some rendered job boards expose UTF-8 text that has already been decoded as
// Windows-1252/Latin-1 (for example, "â€”" instead of an em dash). Only attempt
// the repair when the characteristic marker sequences are present.
function repairMojibake(s) {
  s = s
    .replaceAll('â€”', '—')
    .replaceAll('â€“', '–')
    .replaceAll('â€™', "'")
    .replaceAll('â€˜', "'")
    .replaceAll('â€œ', '“')
    .replaceAll('â€', '”')
    .replaceAll('Â®', '®')
    .replaceAll('Â©', '©')
    .replaceAll('Â ', ' ');
  if (!/(?:Ã.|Â.|â€|â€™|â€œ|â€˜|ðŸ)/.test(s)) return s;
  try {
    const repaired = Buffer.from(s, 'latin1').toString('utf8');
    const before = (s.match(/(?:Ã.|Â.|â€|â€™|â€œ|â€˜|ðŸ)/g) || []).length;
    const after = (repaired.match(/(?:Ã.|Â.|â€|â€™|â€œ|â€˜|ðŸ)/g) || []).length;
    return after < before && !repaired.includes('\uFFFD') ? repaired : s;
  } catch {
    return s;
  }
}

/**
 * Converts ATS job-description HTML to plain markdown-ish text.
 * Some tenants (observed on certain Greenhouse boards) return the description
 * already HTML-entity-encoded — i.e. the literal text "&lt;div&gt;" instead of
 * a real "<div>" tag — so entities are unescaped BEFORE tag-stripping, not after,
 * and unescaped again after in case entities were nested inside real tags.
 * Safe to call on already-plain text: none of these patterns match prose.
 */
export function htmlToText(input) {
  if (!input) return input;
  let html = unescapeEntities(repairMojibake(input));
  return unescapeEntities(
    html
      .replace(/<\/?span[^>]*>/gi, '') // inline — strip with no separator
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<\/?(ul|ol|h[1-6]|div|section|header|footer)[^>]*>/gi, '\n') // block — force a break
      .replace(/<strong>(.*?)<\/strong>/gis, '**$1**')
      .replace(/<b>(.*?)<\/b>/gis, '**$1**')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
}

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const REQUEST_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

export function requestWithTimeout(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport =
      parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!transport) {
      reject(new Error(`Unsupported URL protocol: ${parsed.protocol}`));
      return;
    }

    const req = transport.request(
      parsed,
      {
        method: options.method || 'GET',
        headers: options.headers,
      },
      res => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          const redirectedUrl = new URL(res.headers.location, parsed).toString();
          const redirectedOptions =
            status === 303 ? { ...options, method: 'GET', body: undefined } : options;
          resolve(requestWithTimeout(redirectedUrl, redirectedOptions, redirectCount + 1));
          return;
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || '',
            headers: {
              get(name) {
                const value = res.headers[String(name).toLowerCase()];
                return Array.isArray(value) ? value.join(', ') : (value ?? null);
              },
            },
            text: async () => body,
            json: async () => JSON.parse(body),
          });
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

export function makeHttpCtx() {
  return {
    async get(url, extraHeaders = {}) {
      const res = await requestWithTimeout(url, {
        headers: { ...DEFAULT_HEADERS, ...extraHeaders },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.text();
    },

    async getJson(url, extraHeaders = {}) {
      const res = await requestWithTimeout(url, {
        headers: {
          ...DEFAULT_HEADERS,
          Accept: 'application/json',
          ...extraHeaders,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json();
    },

    async postJson(url, body, extraHeaders = {}) {
      const res = await requestWithTimeout(url, {
        method: 'POST',
        headers: {
          ...DEFAULT_HEADERS,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json();
    },
  };
}
