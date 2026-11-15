import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { win32 } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { createApp } from './app.mjs';
import { createStaticHandler, HTML_CSP, isInsideDirectory } from './static.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

test('serves only regular files under its canonical dist root and SPA paths use index', async t => {
  assert.equal(isInsideDirectory('C:\\build\\dist', 'D:\\outside\\index.html', win32), false);
  assert.equal(isInsideDirectory('C:\\build\\dist', 'C:\\build\\dist\\assets.js', win32), true);
  const base = await mkdtemp(join(tmpdir(), 'career-static-'));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const dist = resolve(base, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<main>built</main>');
  await writeFile(join(dist, 'assets.js'), 'safe');
  await writeFile(join(base, 'outside.txt'), 'private');
  try {
    await symlink(join(base, 'outside.txt'), join(dist, 'escape.txt'));
  } catch {
    /* Windows policy may forbid symlinks */
  }
  const reservation = createServer();
  await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));
  const host = `127.0.0.1:${port}`;
  const app = createApp({
    host,
    origin: `http://${host}`,
    readiness: async () => {},
    staticHandler: createStaticHandler({ distDir: dist }),
  });
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port });
  const origin = `http://${host}`;
  const html = await fetch(`${origin}/#/jobs`);
  assert.equal(html.status, 200);
  assert.equal(await html.text(), '<main>built</main>');
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(html.headers.get('content-security-policy'), /style-src 'self'/);
  assert.doesNotMatch(HTML_CSP, /unsafe-inline|unsafe-eval|https:/);
  assert.equal((await fetch(`${origin}/assets.js`)).status, 200);
  assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  assert.equal((await fetch(`${origin}/%2e%2e/outside.txt`)).status, 404);
  assert.equal((await fetch(`${origin}/missing-route`)).status, 404);
  const unknownApi = await fetch(`${origin}/%61pi/not-found`);
  assert.equal(unknownApi.status, 404);
  assert.equal((await unknownApi.json()).error.code, 'NOT_FOUND');
  assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 405);
  if ((await readFile(join(base, 'outside.txt'), 'utf8')) === 'private') {
    const escaped = await fetch(`${origin}/escape.txt`);
    assert.notEqual(await escaped.text(), 'private');
  }
});
