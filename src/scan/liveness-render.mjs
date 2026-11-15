/**
 * liveness-render.mjs: the rendered-page step of the posting liveness check.
 *
 * createRenderer() returns { renderPage(url), close() }. The browser is launched lazily on the
 * first call (most runs never need one), is shared, and pages are rendered one at a time in a
 * fresh context. It reads the final address and the page HTML only; no challenge bypass, no
 * saved text. `launch` is injectable so tests never start a browser.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function launchChromium() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

export function createRenderer({ launch = launchChromium, settleMs = 1200 } = {}) {
  let browser = null;
  let chain = Promise.resolve();

  async function render(url) {
    browser ||= await launch();
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-CA' });
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response) return null;
      if (response.status() === 429) return { slowDown: true };
      // A refused page (403, 429, 5xx) says nothing about the posting.
      if (response.status() >= 400 && ![404, 410].includes(response.status())) return null;
      await page.waitForTimeout(settleMs);
      return { finalUrl: page.url(), html: await page.content(), status: response.status() };
    } finally {
      await context.close();
    }
  }

  return {
    // Serialized: one rendered page at a time keeps the shared browser light.
    renderPage(url) {
      const run = chain.then(() => render(url));
      chain = run.catch(() => {});
      return run.catch(() => null);
    },
    async close() {
      const open = browser;
      browser = null;
      await open?.close().catch(() => {});
    },
  };
}
