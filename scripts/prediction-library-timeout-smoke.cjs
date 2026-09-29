const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-prediction-library-'));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../dist/web/server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MONEYMONEY_DATA_DIR: dataDir,
      APP_HOST: '127.0.0.1',
      APP_PORT: String(port),
      TELEGRAM_POLLING_ENABLED: 'false',
      AI_PAPER_TRADING_ENABLED: 'false',
      MONEYMONEY_DISABLE_GURU_REFRESH: 'true',
      PRIVATE_KEY: '',
      API_KEY: '',
      MONEYMONEY_LOGIN_USER: 'prediction-library-test',
      MONEYMONEY_LOGIN_PASS: 'local-prediction-library-only-92!',
      MONEYMONEY_JWT_SECRET: 'local-prediction-library-jwt-secret-0123456789abcdef',
    },
    stdio: 'ignore',
  });

  let browser;
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(base + '/api/health/live');
        if (response.ok) { healthy = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(healthy, 'isolated MoneyMoney server should become healthy');

    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = [];
    let radarCalls = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/prediction-radar**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('cachedOnly') === '1' || url.searchParams.get('limit') !== '12') return route.continue();
      radarCalls += 1;
      if (radarCalls === 1) {
        await new Promise(resolve => setTimeout(resolve, 15_000));
        try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { markets: [], opportunities: [], sources: {}, updatedAt: new Date().toISOString() } }) }); } catch {}
        return;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
        updatedAt: '2026-09-29T01:00:00.000Z', opportunities: [], sources: { polymarket: { ok: true, count: 1 } },
        markets: [{ id: 'fixture-001', platform: 'Polymarket', title: 'Fixture prediction event', titleZh: '测试预测事件', category: 'Test', categoryZh: '测试', group: '综合', outcome: 'YES', yesPrice: 0.61, noPrice: 0.39, volume24h: 1000, volumeTotal: 5000, liquidity: 2000, activityScore: 1, internalEdge: 0, modelProbability: 0.6, probabilityConfidence: 50, probabilityZh: '测试' }],
      } }) });
    });

    await page.goto(base + '/?market=stocks', { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).pathname.startsWith('/login')) {
      await page.locator('#guestBtn').click({ timeout: 15_000 });
      await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    }
    await page.locator('#market-workspace-shell').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => setMarketScope('prediction'));
    const quickLibrary = page.locator('#prediction-library-quick');
    await page.waitForFunction(() => document.querySelector('#prediction-library-retry')?.textContent?.includes('重试'), null, { timeout: 14_000 });
    assert.match(await quickLibrary.innerText(), /超时/);
    assert.equal(radarCalls, 1, 'the first slow prediction request should time out without being retried automatically');

    await page.locator('#prediction-library-retry').click();
    await page.getByText('测试预测事件', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(radarCalls, 2, 'manual retry should request the prediction feed again');
    assert.deepEqual(pageErrors, [], 'loading timeout and retry should not cause browser runtime errors');
    console.log('Prediction library timeout smoke passed: slow source becomes an explicit retry state and recovers on retry');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT');
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
