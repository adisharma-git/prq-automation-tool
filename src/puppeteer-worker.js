/**
 * puppeteer-worker.js
 * Runs in a forked child process so it never blocks the Electron UI.
 *
 * ─── HOW TO CUSTOMISE ────────────────────────────────────────────────────────
 *  1. Change TARGET_URL to the site you want to open.
 *  2. Edit the ACTIONS array to add your own click / type / wait steps.
 *  3. The screenshot is saved to the folder chosen in the UI (default: Desktop).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Configuration sent from the renderer ─────────────────────────────────────
process.on('message', async ({ config }) => {
  const {
    url = 'https://example.com',          // ← change your URL here
    saveFolder = path.join(os.homedir(), 'Desktop'),
    headless = false,                      // false = visible browser window
    actions = [],                          // extra actions from the UI
  } = config;

  try {
    log('🚀 Launching browser...');
    const browser = await puppeteer.launch({
      headless,
      defaultViewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // ── 1. Navigate ───────────────────────────────────────────────────────────
    log(`🌐 Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    log(`✅ Page loaded: "${await page.title()}"`);

    // ── 2. Run user-defined actions ───────────────────────────────────────────
    for (const action of actions) {
      if (action.type === 'click' && action.selector) {
        log(`🖱  Clicking: ${action.selector}`);
        await page.waitForSelector(action.selector, { timeout: 8_000 });
        await page.click(action.selector);
        await sleep(500);
      }
      if (action.type === 'type' && action.selector && action.text) {
        log(`⌨️  Typing "${action.text}" into: ${action.selector}`);
        await page.waitForSelector(action.selector, { timeout: 8_000 });
        await page.type(action.selector, action.text, { delay: 60 });
        await sleep(300);
      }
      if (action.type === 'wait') {
        const ms = action.ms || 1000;
        log(`⏳ Waiting ${ms}ms...`);
        await sleep(ms);
      }
      if (action.type === 'scroll') {
        log('📜 Scrolling to bottom...');
        await page.evaluate(() =>
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
        );
        await sleep(800);
      }
    }

    // ── 3. Screenshot ─────────────────────────────────────────────────────────
    if (!fs.existsSync(saveFolder)) fs.mkdirSync(saveFolder, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(saveFolder, `screenshot-${timestamp}.png`);

    log('📸 Taking screenshot...');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    log(`💾 Screenshot saved → ${screenshotPath}`);

    await browser.close();
    log('🏁 Browser closed. All done!');

    process.send({ type: 'done', screenshotPath });
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    process.send({ type: 'error', error: err.message });
  }
});

function log(msg) {
  process.stdout.write(msg + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
