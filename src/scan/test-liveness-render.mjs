import assert from 'node:assert/strict';
import { createRenderer } from './liveness-render.mjs';

process.env.CAREER_OPS_TEST_GUARD = '1';

function fakeBrowser(status = 200, finalUrl = 'https://x.test/jobs') {
  const log = { launches: 0, contexts: 0, closed: 0, running: 0, peak: 0 };
  const browser = {
    async newContext() {
      log.contexts++;
      return {
        async newPage() {
          return {
            async goto() {
              log.running++;
              log.peak = Math.max(log.peak, log.running);
              await new Promise(resolve => setTimeout(resolve, 5));
              return status ? { status: () => status } : null;
            },
            async waitForTimeout() {},
            url: () => finalUrl,
            content: async () => '<html>page</html>',
          };
        },
        async close() {
          log.running--;
          log.closed++;
        },
      };
    },
    async close() {
      log.browserClosed = true;
    },
  };
  return {
    log,
    launch: async () => {
      log.launches++;
      return browser;
    },
  };
}

// Lazy launch: nothing starts until the first render; one shared browser; serialized pages.
{
  const { log, launch } = fakeBrowser();
  const renderer = createRenderer({ launch, settleMs: 0 });
  assert.equal(log.launches, 0);
  await renderer.close();
  assert.equal(log.launches, 0, 'closing an unused renderer launches nothing');
  const results = await Promise.all([
    renderer.renderPage('https://x.test/a'),
    renderer.renderPage('https://x.test/b'),
  ]);
  assert.deepEqual(results[0], {
    finalUrl: 'https://x.test/jobs',
    html: '<html>page</html>',
    status: 200,
  });
  assert.equal(log.launches, 1);
  assert.equal(log.peak, 1, 'one page at a time');
  assert.equal(log.closed, 2, 'every context is closed');
  await renderer.close();
  assert.equal(log.browserClosed, true);
}

// A refused page says nothing; a 404 page is returned for the caller to judge; errors are null.
{
  const render = status => {
    const { launch } = fakeBrowser(status);
    return createRenderer({ launch, settleMs: 0 }).renderPage('https://x.test');
  };
  assert.equal(await render(403), null);
  assert.deepEqual(await render(429), { slowDown: true });
  assert.equal(await render(0), null);
  assert.equal((await render(404)).status, 404);
  const broken = createRenderer({
    launch: async () => {
      throw new Error('no chromium');
    },
  });
  assert.equal(await broken.renderPage('https://x.test'), null);
  await broken.close();
}

console.log('liveness render tests OK');
