import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path, { extname, resolve, sep } from 'node:path';
import root from '../lib/root.mjs';

const HTML_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function isInsideDirectory(base, candidate, pathApi = path) {
  const rel = pathApi.relative(base, candidate);
  return (
    rel === '' || (!pathApi.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${pathApi.sep}`))
  );
}

export function createStaticHandler({ distDir = resolve(root, 'web', 'dist') } = {}) {
  const configured = resolve(distDir);
  return async function serveStatic(request, reply) {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return reply.code(405).header('allow', 'GET, HEAD').send();
    if (
      request.url === '/api' ||
      request.url.startsWith('/api/') ||
      request.url.startsWith('/api?')
    )
      return reply
        .code(404)
        .type('application/json')
        .send({
          error: {
            code: 'NOT_FOUND',
            message: 'Route not found.',
            requestId: request.requestId,
            retryable: false,
          },
        });
    let base;
    try {
      base = await realpath(configured);
    } catch {
      return reply.code(503).type('text/plain').send('Web build is unavailable.');
    }
    if (base !== configured)
      return reply.code(503).type('text/plain').send('Web build is unavailable.');
    const rawPath = request.url.split('?', 1)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return reply.code(400).send();
    }
    if (decoded === '/api' || decoded.startsWith('/api/'))
      return reply
        .code(404)
        .type('application/json')
        .send({
          error: {
            code: 'NOT_FOUND',
            message: 'Route not found.',
            requestId: request.requestId,
            retryable: false,
          },
        });
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..'))
      return reply.code(404).send();
    const requested = decoded === '/' ? '/index.html' : decoded;
    const candidate = resolve(base, `.${requested}`);
    if (!isInsideDirectory(base, candidate)) return reply.code(404).send();
    let actual;
    try {
      actual = await realpath(candidate);
    } catch {
      actual = null;
    }
    if (!actual || !isInsideDirectory(base, actual)) return reply.code(404).send();
    let info;
    try {
      info = await stat(actual);
    } catch {
      return reply.code(404).send();
    }
    if (!info.isFile()) return reply.code(404).send();
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('content-security-policy', HTML_CSP);
    reply.header('cache-control', actual.endsWith(`${sep}index.html`) ? 'no-store' : 'no-cache');
    reply.type(TYPES.get(extname(actual).toLowerCase()) || 'application/octet-stream');
    if (request.method === 'HEAD') return reply.send();
    return reply.send(createReadStream(actual));
  };
}

export { HTML_CSP };
