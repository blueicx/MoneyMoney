const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-guru-view-race-'));
const secUrl = 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/infotable.xml';

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
      MONEYMONEY_LOGIN_USER: 'guru-race-owner',
      MONEYMONEY_LOGIN_PASS: 'local-guru-race-test-only-92!',
      MONEYMONEY_JWT_SECRET: 'local-guru-race-jwt-secret-0123456789abcdef',
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
    const consensusRequests = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/stocks/guru-holdings/**', async route => {
      const url = new URL(route.request().url());
      const routeName = url.pathname.split('/').filter(Boolean).at(-1);
      let payload;
      if (routeName === 'managers') {
        payload = { market: 'stocks', dataStatus: 'historical', source: 'SEC fixture', updatedAt: '2026-09-29T01:00:00.000Z', reason: null, evidenceRefs: [], data: [] };
      } else if (routeName === 'consensus') {
        const symbol = url.searchParams.get('symbol') || null;
        const reportPeriod = url.searchParams.get('reportPeriod') || '2026-06-30';
        consensusRequests.push({ symbol, reportPeriod });
        payload = {
          market: 'stocks', instrument: symbol, reportPeriod,
          availableReportPeriods: ['2026-06-30', '2026-03-31'],
          trackedManagerCount: 2, reportManagerCount: 0, missingManagerCount: 2,
          unavailableManagerCount: 0, partialManagerCount: 0, staleManagerCount: 0,
          incomparableManagerCount: 0, dataStatus: 'partial', source: 'SEC EDGAR Form 13F',
          updatedAt: '2026-09-29T01:00:00.000Z',
          reason: '测试快照不含申报明细。', evidenceRefs: [secUrl], rows: [],
        };
      } else if (routeName === 'MSFT' || routeName === 'AAPL') {
        payload = { market: 'stocks', instrument: routeName, dataStatus: 'empty', source: 'SEC fixture', updatedAt: null, reason: '测试无持仓明细。', evidenceRefs: [], mapping: null, holders: [], caveats: [] };
      } else {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'unknown fixture route' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });

    await page.goto(base + '/?market=stocks&workspace=guru-holdings&instrument=AAPL', { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).pathname.startsWith('/login')) {
      await page.locator('#guestBtn').click({ timeout: 15_000 });
      await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    }
    await page.locator('#market-workspace-shell').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => window.openWorkspace('guru-holdings'));
    await page.locator('#guru-holdings-tab').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('[data-guru-view="consensus"]').click();
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content')?.textContent?.includes('同一报告期'), null, { timeout: 10_000 });

    const requestCountBeforeSelection = consensusRequests.length;
    await page.evaluate(() => selectStockFromInstrumentLibrary('MSFT', 'Microsoft Corporation', 'MSFT'));
    await page.waitForTimeout(1_800);
    const selectionState = await page.evaluate(() => ({
      view: guruHoldingsView,
      search: document.querySelector('#guru-holdings-search')?.value,
      content: document.querySelector('#guru-holdings-content')?.textContent || '',
    }));
    assert.equal(selectionState.view, 'consensus', 'selecting another stock must preserve the explicitly selected consensus view');
    assert.equal(selectionState.search, 'MSFT', 'consensus should follow the newly selected stock');
    assert.match(selectionState.content, /同一报告期机构重合/, 'the consensus panel should remain rendered after selection');

    assert.ok(consensusRequests.slice(requestCountBeforeSelection).some(item => item.symbol === 'MSFT'), 'selected instrument should refresh consensus for that stock');
    assert.deepEqual(pageErrors, [], 'the selection flow should not cause browser runtime errors');
    console.log('Guru consensus instrument-selection smoke passed: selected stock preserved the consensus tab and refreshed scoped data');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT');
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
