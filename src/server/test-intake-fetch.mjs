import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.mjs';
import { fetchAtsJobPosting } from '../scan/providers/_canonical-jd.mjs';
import { createIntakeFetchService, extractJobFields, isPrivateAddress } from './intake-fetch.mjs';

// Mocked HTTP only: no live request, no real DNS, no real key.

const SECRET = 'fc-test-secret-key-0123456789';
const PUBLIC_DNS = async () => [{ address: '93.184.216.34', family: 4 }];
const LONG = 'Build and run data pipelines for the team. '.repeat(20).trim();

const jsonLd = (extra = {}) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Senior Data Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Acme &amp; Co' },
    jobLocation: {
      '@type': 'Place',
      address: { addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' },
    },
    description: `<p>${LONG}</p>`,
    ...extra,
  })}</script></head><body></body></html>`;

const page = html => async () => ({ ok: true, status: 200, text: async () => html });

function firecrawlReply({ status = 200, body } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const scrapeBody = (overrides = {}) => ({
  success: true,
  data: {
    markdown: `# Posting\n\n${LONG}`,
    metadata: { statusCode: 200 },
    ...overrides,
  },
});

function makeService({
  extract,
  atsPosting,
  resolve,
  pageFetch,
  httpFetch,
  config,
  env = {},
  ...rest
} = {}) {
  const calls = { http: [], resolve: [], pages: [], config: [], ats: [], extract: [] };
  const service = createIntakeFetchService({
    rootDir: '/repo',
    env,
    lookupHost: PUBLIC_DNS,
    readConfig: async path => {
      calls.config.push(path);
      if (config === undefined) throw new Error('ENOENT');
      return config;
    },
    extract: async text => {
      calls.extract.push(text);
      return extract ? extract(text) : null;
    },
    atsPosting: async (url, options) => {
      calls.ats.push(url);
      return atsPosting ? atsPosting(url, options) : null;
    },
    resolve: async (hit, options) => {
      calls.resolve.push(hit);
      return resolve ? resolve(hit, options) : null;
    },
    pageFetch: async (url, options) => {
      calls.pages.push(url);
      return pageFetch ? pageFetch(url, options) : { ok: false, status: 404, text: async () => '' };
    },
    httpFetch: async (url, options) => {
      calls.http.push({ url, options });
      return httpFetch ? httpFetch(url, options) : firecrawlReply({ body: scrapeBody() })();
    },
    ...rest,
  });
  return { service, calls };
}

const rejects = (promise, statusCode, code) =>
  assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode, error.message);
    assert.equal(error.publicCode, code);
    assert.ok(!JSON.stringify(error.message).includes(SECRET));
    return true;
  });

test('resolver path: Greenhouse JSON text plus JSON-LD fields, Firecrawl untouched', async () => {
  const { service, calls } = makeService({
    resolve: async () => ({ text: LONG, method: 'greenhouse' }),
    pageFetch: page(jsonLd()),
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
  });
  const result = await service.fetch({ url: 'boards.greenhouse.io/acme/jobs/123' });
  assert.deepEqual(result, {
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    company: 'Acme & Co',
    role: 'Senior Data Engineer',
    location: 'Toronto, ON, CA',
    text: LONG,
    source: 'resolver',
    method: 'greenhouse',
    warnings: [],
  });
  assert.equal(calls.http.length, 0);
  assert.deepEqual(calls.resolve, [{ apply_url: 'https://boards.greenhouse.io/acme/jobs/123' }]);
});

test('ATS JSON supplies all fields with no page fetch and no Firecrawl', async () => {
  const { service, calls } = makeService({
    atsPosting: async () => ({
      text: LONG,
      method: 'greenhouse',
      company: 'Databricks',
      role: 'Solutions Architect',
      location: 'Tokyo, Japan',
    }),
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
  });
  const result = await service.fetch({ url: 'https://job-boards.greenhouse.io/d/jobs/1' });
  assert.equal(result.company, 'Databricks');
  assert.equal(result.role, 'Solutions Architect');
  assert.equal(result.location, 'Tokyo, Japan');
  assert.equal(result.method, 'greenhouse');
  assert.equal(result.source, 'resolver');
  assert.equal(calls.http.length, 0);
  assert.equal(calls.resolve.length, 0);
  assert.equal(calls.pages.length, 0);
});

test('ATS fields with gaps are completed from the page JSON-LD', async () => {
  const { service } = makeService({
    atsPosting: async () => ({
      text: LONG,
      method: 'lever',
      company: null,
      role: 'Kept Title',
      location: null,
    }),
    pageFetch: page(jsonLd()),
  });
  const result = await service.fetch({ url: 'https://jobs.lever.co/acme/abc' });
  assert.equal(result.role, 'Kept Title');
  assert.equal(result.company, 'Acme & Co');
  assert.equal(result.location, 'Toronto, ON, CA');
});

test('resolver path: a JSON-LD page supplies text and fields; remote type is added', async () => {
  const { service } = makeService({
    resolve: async () => ({ text: LONG, method: 'canonical-json' }),
    pageFetch: page(jsonLd({ jobLocationType: 'TELECOMMUTE' })),
  });
  const result = await service.fetch({ url: 'https://careers.example.com/jobs/9' });
  assert.equal(result.source, 'resolver');
  assert.equal(result.method, 'canonical-json');
  assert.equal(result.location, 'Toronto, ON, CA; Remote');
});

test('extractJobFields handles arrays, @graph, string organizations and bad blocks', () => {
  const graph = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["JobPosting"],"title":"Analyst","hiringOrganization":"Initech","jobLocation":[{"address":{"addressLocality":"Ottawa"}},{"address":"Remote - Canada"}]}]}</script>`;
  assert.deepEqual(extractJobFields(`<script type="application/ld+json">{oops</script>${graph}`), {
    company: 'Initech',
    role: 'Analyst',
    location: 'Ottawa; Remote - Canada',
  });
  assert.deepEqual(extractJobFields('<html></html>'), {
    company: null,
    role: null,
    location: null,
  });
});

test('Firecrawl fallback when the resolver returns no text', async () => {
  const { service, calls } = makeService({
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
  });
  const result = await service.fetch({ url: 'https://jobs.example.com/p/1' });
  assert.equal(result.source, 'firecrawl');
  assert.equal(result.method, 'firecrawl-scrape');
  assert.equal(result.company, null);
  assert.ok(result.text.startsWith('# Posting'));
  assert.equal(calls.extract.length, 1);
  assert.equal(calls.http.length, 1);
  const { url, options } = calls.http[0];
  assert.equal(url, 'https://api.firecrawl.dev/v2/scrape');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, `Bearer ${SECRET}`);
  const sent = JSON.parse(options.body);
  assert.equal(sent.url, 'https://jobs.example.com/p/1');
  assert.equal(sent.onlyMainContent, true);
  assert.equal(sent.timeout, 30000);
  assert.deepEqual(sent.formats, ['markdown']);
  assert.deepEqual(Object.keys(sent).sort(), ['formats', 'onlyMainContent', 'timeout', 'url']);
  assert.ok(!options.body.includes(SECRET));
});

const extraction = (overrides = {}) => ({
  ok: true,
  company: 'Globex',
  role: 'Analyst',
  location: 'Toronto',
  description: LONG,
  note: 'Cleaned by model: kept 860 of 1200 characters.',
  ...overrides,
});

test('extraction after Firecrawl: fields fill nulls, description replaces text, method gets +llm', async () => {
  const { service, calls } = makeService({
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
    extract: async () => extraction(),
  });
  const result = await service.fetch({ url: 'https://recruiting.example.com/job/1' });
  assert.equal(result.text, LONG);
  assert.equal(result.company, 'Globex');
  assert.equal(result.role, 'Analyst');
  assert.equal(result.location, 'Toronto');
  assert.equal(result.source, 'firecrawl');
  assert.equal(result.method, 'firecrawl-scrape+llm');
  assert.deepEqual(result.warnings, ['Cleaned by model: kept 860 of 1200 characters.']);
  assert.equal(calls.http.length, 1);
  assert.ok(calls.extract[0].startsWith('# Posting'));
});

test('extraction fills nulls only and never overwrites fields the page already gave', async () => {
  const { service } = makeService({
    resolve: async () => ({ text: LONG, method: 'canonical-json' }),
    pageFetch: page(jsonLd({ title: 'Page Title' })),
    extract: async () => extraction({ role: 'Model Title', location: 'Elsewhere' }),
  });
  const result = await service.fetch({ url: 'https://careers.example.com/jobs/9' });
  assert.equal(result.role, 'Page Title');
  assert.equal(result.company, 'Acme & Co');
  assert.equal(result.location, 'Toronto, ON, CA');
  assert.equal(result.method, 'canonical-json+llm');
});

test('a discarded or failed extraction keeps the fetched text and adds the warning', async () => {
  for (const warning of [
    'Model extraction was discarded; text kept as fetched.',
    'Model extraction failed; text kept as fetched.',
  ]) {
    const { service } = makeService({
      config: JSON.stringify({ version: 1, apiKey: SECRET }),
      extract: async () => ({ ok: false, warning }),
    });
    const result = await service.fetch({ url: 'https://recruiting.example.com/job/1' });
    assert.ok(result.text.startsWith('# Posting'));
    assert.equal(result.method, 'firecrawl-scrape');
    assert.equal(result.company, null);
    assert.deepEqual(result.warnings, [warning]);
  }
});

test('ATS results skip the model step; every other source runs it', async () => {
  for (const method of ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday']) {
    const { service, calls } = makeService({
      atsPosting: async () => ({ text: LONG, method, company: 'A', role: 'B', location: 'C' }),
      extract: async () => extraction(),
    });
    const result = await service.fetch({ url: 'https://ats.example.com/job/1' });
    assert.equal(calls.extract.length, 0, method);
    assert.equal(result.method, method);
  }
  const { service, calls } = makeService({
    resolve: async () => ({ text: LONG, method: 'canonical-json' }),
    pageFetch: page('<html></html>'),
  });
  await service.fetch({ url: 'https://careers.example.com/jobs/9' });
  assert.equal(calls.extract.length, 1);
});

test('resolver text with missing company or role does not spend a Firecrawl credit', async () => {
  const { service, calls } = makeService({
    resolve: async () => ({ text: LONG, method: 'canonical-json' }),
    pageFetch: page('<html></html>'),
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
    extract: async () => extraction(),
  });
  const result = await service.fetch({ url: 'https://careers.example.com/jobs/9' });
  assert.equal(calls.http.length, 0);
  assert.equal(result.company, 'Globex');
});

test('excluded hosts skip the resolver and go straight to Firecrawl', async () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/123',
    'https://ca.indeed.com/viewjob?jk=abc',
    'https://www.glassdoor.com/job-listing/x',
  ]) {
    const { service, calls } = makeService({
      config: JSON.stringify({ version: 1, apiKey: SECRET }),
    });
    const result = await service.fetch({ url });
    assert.equal(result.source, 'firecrawl', url);
    assert.equal(calls.resolve.length, 0, url);
    assert.equal(calls.pages.length, 0, url);
    assert.equal(calls.http.length, 1, url);
  }
});

test('hiring.cafe URLs are refused before any request, even with a key', async () => {
  for (const url of [
    'https://hiring.cafe/job/abc',
    'https://www.hiring.cafe/jobs/data-engineer',
    'https://hiringcafe.com/job/1',
    'https://app.hiringcafe.com/job/1',
  ]) {
    const { service, calls } = makeService({
      config: JSON.stringify({ version: 1, apiKey: SECRET }),
    });
    await assert.rejects(service.fetch({ url }), error => {
      assert.equal(error.statusCode, 422, url);
      assert.equal(error.publicCode, 'INTAKE_FETCH_EMPTY', url);
      assert.equal(
        error.message,
        "hiring.cafe pages are not fetched; use the employer's apply link or paste the description.",
      );
      return true;
    });
    assert.equal(
      calls.http.length +
        calls.resolve.length +
        calls.pages.length +
        calls.ats.length +
        calls.config.length,
      0,
      url,
    );
  }
});

test('the key may come from the environment, which wins over the file', async () => {
  const { service, calls } = makeService({
    env: { FIRECRAWL_API_KEY: 'fc-from-env' },
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
  });
  await service.fetch({ url: 'https://www.linkedin.com/jobs/view/1' });
  assert.equal(calls.http[0].options.headers.Authorization, 'Bearer fc-from-env');
  assert.equal(calls.config.length, 0);
});

test('not configured: resolver text needs no Firecrawl, so there is no warning', async () => {
  const { service, calls } = makeService({
    resolve: async () => ({ text: LONG, method: 'ashby' }),
    pageFetch: page('<html></html>'),
  });
  const result = await service.fetch({ url: 'https://jobs.ashbyhq.com/acme/1' });
  assert.equal(calls.http.length, 0);
  assert.equal(calls.config.length, 0);
  assert.equal(result.text, LONG);
  assert.deepEqual(result.warnings, []);
});

test('not configured and nothing readable is 422 with the hint', async () => {
  const { service } = makeService();
  await assert.rejects(service.fetch({ url: 'https://www.linkedin.com/jobs/view/1' }), error => {
    assert.equal(error.statusCode, 422);
    assert.equal(error.publicCode, 'INTAKE_FETCH_EMPTY');
    assert.match(error.message, /Nothing readable at that address; paste the description\./);
    assert.match(error.message, /Firecrawl is not configured/);
    return true;
  });
});

test('an invalid key file is named in the 422 hint, never echoed', async () => {
  for (const config of ['{not json', JSON.stringify({ version: 2, apiKey: SECRET })]) {
    const { service, calls } = makeService({ config });
    await assert.rejects(service.fetch({ url: 'https://www.linkedin.com/jobs/view/1' }), error => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /not valid; expected/);
      assert.ok(!error.message.includes(SECRET));
      return true;
    });
    assert.equal(calls.http.length, 0);
  }
});

test('Firecrawl HTTP failures are 502 and never leak the key or the body', async () => {
  for (const status of [401, 402, 429, 500, 503]) {
    const { service } = makeService({
      config: JSON.stringify({ version: 1, apiKey: SECRET }),
      httpFetch: firecrawlReply({
        status,
        body: { success: false, error: `raw body mentions ${SECRET} and internals` },
      }),
    });
    await assert.rejects(service.fetch({ url: 'https://www.linkedin.com/jobs/view/1' }), error => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.publicCode, 'INTAKE_FETCH_FAILED');
      assert.match(error.message, /^Firecrawl fetch failed: /);
      assert.ok(!error.message.includes(SECRET));
      assert.ok(!error.message.includes('internals'));
      return true;
    });
  }
});

test('Firecrawl network errors, unreadable replies and success:false are 502', async () => {
  const cases = [
    async () => {
      throw new Error(`socket hang up ${SECRET}`);
    },
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    }),
    firecrawlReply({ body: { success: false } }),
  ];
  for (const httpFetch of cases) {
    const { service } = makeService({
      config: JSON.stringify({ version: 1, apiKey: SECRET }),
      httpFetch,
    });
    await assert.rejects(service.fetch({ url: 'https://www.linkedin.com/jobs/view/1' }), error => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.publicCode, 'INTAKE_FETCH_FAILED');
      assert.ok(!error.message.includes(SECRET));
      return true;
    });
  }
});

test('a scrape with no markdown is 422 and records the page status', async () => {
  const { service } = makeService({
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
    httpFetch: firecrawlReply({
      body: scrapeBody({ markdown: '   ', metadata: { statusCode: 404 } }),
    }),
  });
  await rejects(
    service.fetch({ url: 'https://www.linkedin.com/jobs/view/1' }),
    422,
    'INTAKE_FETCH_EMPTY',
  );
});

test('a slow resolver is cut off at the budget and Firecrawl takes over', async () => {
  const { service, calls } = makeService({
    resolverBudgetMs: 20,
    resolve: () => new Promise(() => {}),
    config: JSON.stringify({ version: 1, apiKey: SECRET }),
  });
  const result = await service.fetch({ url: 'https://slow.example.com/job/1' });
  assert.equal(result.source, 'firecrawl');
  assert.equal(calls.http.length, 1);
});

test('text over 1 MB is shortened with a warning', async () => {
  const { service } = makeService({
    resolve: async () => ({ text: 'a'.repeat(1024 * 1024 + 500), method: 'greenhouse' }),
    pageFetch: page(jsonLd()),
  });
  const result = await service.fetch({ url: 'https://boards.greenhouse.io/a/jobs/1' });
  assert.equal(Buffer.byteLength(result.text), 1024 * 1024);
  assert.match(result.warnings.join(' '), /1 MB/);
});

test('URL validation: loopback, private, link-local, login and non-http are rejected before any request', async () => {
  const { service, calls } = makeService({
    lookupHost: async host =>
      host === 'rebind.example.com'
        ? [{ address: '10.0.0.5', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
  });
  const bad = [
    'http://127.0.0.1:4310/api/v1/health',
    'http://localhost:4310/',
    'http://foo.localhost/',
    'http://printer.local/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://10.1.2.3/',
    'http://172.16.0.9/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/',
    'http://2130706433/',
    'http://rebind.example.com/',
    'https://user:pass@example.com/',
    'ftp://example.com/x',
    'javascript:alert(1)',
  ];
  for (const url of bad)
    await assert.rejects(service.fetch({ url }), error => {
      assert.equal(error.statusCode, 400, url);
      assert.equal(error.publicCode, 'INVALID_REQUEST', url);
      assert.deepEqual(Object.keys(error.fields), ['url'], url);
      return true;
    });
  assert.equal(calls.http.length + calls.resolve.length + calls.pages.length, 0);
});

test('body validation: strict keys, string url, length', async () => {
  const { service } = makeService();
  for (const body of [null, [], {}, { url: 5 }, { url: '' }, { url: 'x'.repeat(2049) }])
    await rejects(service.fetch(body), 400, 'INVALID_REQUEST');
  await rejects(service.fetch({ url: 'https://example.com/a', extra: 1 }), 400, 'INVALID_REQUEST');
  const unresolved = makeService({
    lookupHost: async () => {
      throw new Error('ENOTFOUND');
    },
  });
  await rejects(
    unresolved.service.fetch({ url: 'https://nope.example.com/a' }),
    400,
    'INVALID_REQUEST',
  );
});

test('fetchAtsJobPosting reads fields from Greenhouse and Lever JSON, null for unknown hosts', async () => {
  const json = body => async () => ({ ok: true, status: 200, json: async () => body });
  const gh = await fetchAtsJobPosting('https://job-boards.greenhouse.io/acme/jobs/55', {
    fetchImpl: json({
      content: `<p>${LONG}</p>`,
      title: 'Data Engineer',
      company_name: 'Acme',
      location: { name: 'Toronto' },
    }),
  });
  assert.deepEqual(
    { ...gh, text: gh.text.slice(0, 5) },
    {
      text: 'Build',
      company: 'Acme',
      role: 'Data Engineer',
      location: 'Toronto',
      method: 'greenhouse',
    },
  );
  const lever = await fetchAtsJobPosting('https://jobs.lever.co/acme/abc', {
    fetchImpl: json({
      descriptionPlain: LONG,
      text: 'ML Engineer',
      categories: { location: 'Remote' },
    }),
  });
  assert.equal(lever.method, 'lever');
  assert.equal(lever.role, 'ML Engineer');
  assert.equal(lever.location, 'Remote');
  assert.equal(lever.company, null);
  assert.equal(await fetchAtsJobPosting('https://example.com/job', { fetchImpl: json({}) }), null);
  assert.equal(await fetchAtsJobPosting('not a url'), null);
});

test('isPrivateAddress classifies the ranges that matter', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '172.31.255.255', '192.168.0.1'])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['::1', 'fc00::1', 'fe80::1', '::ffff:7f00:1', '::'])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])
    assert.equal(isPrivateAddress(address), false, address);
});

// Route: the guard (nonce, JSON), the body limit, the response schema and the 503 case.
const host = '127.0.0.1:4310';
const NONCE = 'intake-fetch-nonce-value-0000000000000';
const headers = {
  host,
  'content-type': 'application/json',
  'x-career-ops-session': NONCE,
};
const stubIntake = { check: async () => ({ url: null, tracked: null, seen: null }) };

async function withApp(options, callback) {
  const app = createApp({
    host,
    origin: `http://${host}`,
    nonce: NONCE,
    runsService: null,
    intakeService: stubIntake,
    ...options,
  });
  try {
    await callback(app);
  } finally {
    await app.close();
  }
}

test('POST /intake/fetch: guarded, schema-shaped, and 503 without a service', async () => {
  const data = {
    url: 'https://example.com/job',
    company: 'Acme',
    role: 'Engineer',
    location: null,
    text: LONG,
    source: 'resolver',
    method: 'lever',
    warnings: [],
  };
  const seen = [];
  await withApp(
    {
      intakeFetchService: {
        fetch: async body => {
          seen.push(body);
          return data;
        },
      },
    },
    async app => {
      const post = (payload, extra = {}) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/intake/fetch',
          headers: { ...headers, ...extra },
          payload: JSON.stringify(payload),
        });
      const ok = await post({ url: 'https://example.com/job' });
      assert.equal(ok.statusCode, 200);
      assert.deepEqual(ok.json().data, data);
      assert.deepEqual(seen, [{ url: 'https://example.com/job' }]);
      const { 'x-career-ops-session': _omit, ...noNonce } = headers;
      for (const extra of [
        { 'x-career-ops-session': 'wrong' },
        { 'content-type': 'text/plain' },
        { origin: 'http://evil.example' },
      ])
        assert.ok((await post({ url: 'https://example.com/job' }, extra)).statusCode >= 400);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/v1/intake/fetch',
        headers: noNonce,
        payload: JSON.stringify({ url: 'https://example.com/job' }),
      });
      assert.ok(missing.statusCode >= 400);
      assert.equal((await post({ url: 'a'.repeat(9000) })).statusCode, 413);
      const query = await app.inject({
        method: 'POST',
        url: '/api/v1/intake/fetch?x=1',
        headers,
        payload: JSON.stringify({ url: 'https://example.com/job' }),
      });
      assert.equal(query.statusCode, 400);
    },
  );
  await withApp({ intakeFetchService: null }, async app => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/fetch',
      headers,
      payload: JSON.stringify({ url: 'https://example.com/job' }),
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'INTAKE_UNAVAILABLE');
  });
});

test('route maps service errors to public errors without raw text', async () => {
  await withApp(
    {
      intakeFetchService: {
        fetch: async () => {
          const error = new Error(
            'Firecrawl fetch failed: the account is out of credits (HTTP 402).',
          );
          error.statusCode = 502;
          error.publicCode = 'INTAKE_FETCH_FAILED';
          throw error;
        },
      },
    },
    async app => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/intake/fetch',
        headers,
        payload: JSON.stringify({ url: 'https://example.com/job' }),
      });
      assert.equal(response.statusCode, 502);
      assert.equal(response.json().error.code, 'INTAKE_FETCH_FAILED');
    },
  );
});
