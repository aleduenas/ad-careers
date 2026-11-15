/**
 * liveness-urls.mjs: pure URL parsers for the posting liveness check.
 *
 * Each parser returns the employer-board addresses for one saved posting link, or null when the
 * link is not that board's. Nothing here makes a request.
 */

const segments = url => url.pathname.split('/').filter(Boolean);

export function isHiringCafe(url) {
  return (
    url.hostname === 'hiring.cafe' ||
    url.hostname === 'hiringcafe.com' ||
    url.hostname.endsWith('.hiringcafe.com') ||
    url.hostname.endsWith('.hiring.cafe')
  );
}

const underDomain = (url, domain) => url.hostname === domain || url.hostname.endsWith('.' + domain);

/**
 * Sites the check never requests or renders (hiring.cafe, LinkedIn, Indeed): the reason text,
 * or null for any other site.
 */
export function neverRequested(url) {
  if (isHiringCafe(url)) return "The saved link is a hiring.cafe page, not the employer's.";
  if (underDomain(url, 'linkedin.com') || underDomain(url, 'indeed.com'))
    return 'LinkedIn and Indeed pages are never requested; check this one by hand.';
  return null;
}

export function greenhouseParts(url) {
  if (!/greenhouse\.io$/i.test(url.hostname)) return null;
  const parts = segments(url);
  const jobsIndex = parts.indexOf('jobs');
  const board = url.searchParams.get('for') || (jobsIndex > 0 ? parts[jobsIndex - 1] : parts[0]);
  const id =
    url.searchParams.get('token') ||
    url.searchParams.get('gh_jid') ||
    (jobsIndex >= 0 ? parts[jobsIndex + 1] : null);
  return board && id && /^\d+$/.test(id.split('?')[0]) ? { board, id: id.split('?')[0] } : null;
}

export function leverParts(url) {
  if (!/(^|\.)lever\.co$/i.test(url.hostname)) return null;
  const [board, id] = segments(url);
  if (!board || !id) return null;
  const apiHost = url.hostname.startsWith('jobs.eu.') ? 'api.eu.lever.co' : 'api.lever.co';
  return { apiHost, board, id };
}

export function ashbyParts(url) {
  if (url.hostname !== 'jobs.ashbyhq.com') return null;
  const [board, id] = segments(url);
  return board && id ? { board, id } : null;
}

export function smartrecruitersParts(url) {
  if (!/(^|\.)smartrecruiters\.com$/i.test(url.hostname)) return null;
  const [company, slug] = segments(url);
  return company && slug ? { company, id: slug.split('-')[0] } : null;
}

export function workdayParts(url) {
  if (!/\.myworkdayjobs\.com$/i.test(url.hostname)) return null;
  const parts = segments(url);
  const jobIndex = parts.indexOf('job');
  if (jobIndex < 1 || jobIndex === parts.length - 1) return null;
  const site = parts[jobIndex - 1];
  const tenant = url.hostname.split('.')[0];
  const externalPath = `/${parts.slice(jobIndex).join('/')}`;
  const base = `${url.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;
  const leaf = parts[parts.length - 1];
  // "Data-Engineer_R-1234" -> "Data Engineer": the board search finds the job by its title.
  const title = decodeURIComponent(leaf.split('_')[0]).replace(/-+/g, ' ').trim();
  return { api: `${base}${externalPath}`, search: `${base}/jobs`, leaf, title };
}

export function workableParts(url) {
  if (url.hostname !== 'apply.workable.com') return null;
  const parts = segments(url);
  const at = parts.indexOf('j');
  if (at < 1 || !parts[at + 1]) return null;
  const account = parts[at - 1];
  return {
    api: `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(account)}/jobs/${encodeURIComponent(parts[at + 1])}`,
  };
}

export function bamboohrParts(url) {
  const host = url.hostname.match(/^([a-z0-9-]+)\.bamboohr\.com$/i);
  if (!host) return null;
  const id = url.searchParams.get('id') || (/\/careers\/(\d+)/.exec(url.pathname) || [])[1];
  return id && /^\d+$/.test(id)
    ? { list: `https://${host[1]}.bamboohr.com/careers/list`, id }
    : null;
}

export function breezyParts(url) {
  const host = url.hostname.match(/^([a-z0-9-]+)\.breezy\.hr$/i);
  if (!host) return null;
  const parts = segments(url);
  if (parts[0] !== 'p' || !parts[1]) return null;
  return { list: `https://${host[1]}.breezy.hr/json`, slug: parts[1] };
}

export function pinpointParts(url) {
  if (!/^[a-z0-9-]+\.pinpointhq\.com$/i.test(url.hostname)) return null;
  const parts = segments(url);
  const at = parts.indexOf('postings');
  if (at < 0 || !parts[at + 1]) return null;
  return { list: `${url.origin}/postings.json`, id: parts[at + 1] };
}

export function successfactorsParts(url) {
  if (!/successfactors\.(?:com|eu)|jobs2web\.com/i.test(url.hostname)) return null;
  const parts = segments(url);
  const at = parts.indexOf('job');
  if (at < 0) return null;
  const id = parts.slice(at + 1).find(part => /^\d+/.test(part));
  if (!id) return null;
  const prefix = parts.slice(0, at).join('/');
  return {
    base: url.origin + (prefix ? '/' + prefix : ''),
    origin: url.origin,
    id: id.match(/^\d+/)[0],
  };
}

export function himalayasParts(url) {
  if (!/(^|\.)himalayas\.app$/i.test(url.hostname)) return null;
  const parts = segments(url);
  const at = parts.indexOf('jobs');
  if (parts[0] !== 'companies' || at < 2 || !parts[at + 1]) return null;
  const slug = parts[at + 1];
  return { slug, query: decodeURIComponent(slug).replace(/-+/g, ' ').trim() };
}

export function icimsHost(url) {
  return /(^|\.)icims\.com$/i.test(url.hostname);
}

/** Stable key for one employer board, used by the per-board outage limit. */
export function boardKey(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'invalid';
  }
  const g = greenhouseParts(url);
  if (g) return `greenhouse:${g.board.toLowerCase()}`;
  const l = leverParts(url);
  if (l) return `lever:${l.board.toLowerCase()}`;
  const a = ashbyParts(url);
  if (a) return `ashby:${a.board.toLowerCase()}`;
  const s = smartrecruitersParts(url);
  if (s) return `smartrecruiters:${s.company.toLowerCase()}`;
  const w = workdayParts(url);
  if (w) return `workday:${url.hostname.toLowerCase()}`;
  if (himalayasParts(url)) return 'himalayas:' + segments(url)[1].toLowerCase();
  const wk = url.hostname === 'apply.workable.com' ? segments(url)[0] : null;
  if (wk) return `workable:${wk.toLowerCase()}`;
  return `host:${url.hostname.toLowerCase()}`;
}
