const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 3193;
const base = `http://127.0.0.1:${port}`;
const username = 'experience-owner';
const password = 'local-experience-smoke-only-92!';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-experience-smoke-'));
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
    MONEYMONEY_LOGIN_USER: username,
    MONEYMONEY_LOGIN_PASS: password,
    MONEYMONEY_JWT_SECRET: 'local-experience-smoke-jwt-secret-0123456789abcdef',
  },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const response = await fetch(`${base}/api/health/live`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('isolated workspace-experience server did not become healthy');
}

async function stopServer() {
  if (child.exitCode == null) {
    child.kill('SIGINT');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2500)),
    ]);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  const resolved = path.resolve(dataDir);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('moneymoney-experience-smoke-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function main() {
  let browser;
  const pageErrors = [];
  const klinePeriods = [];
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));
    await page.addInitScript(() => {
      const original = Node.prototype.insertBefore;
      Node.prototype.insertBefore = function(node, reference) {
        try { return original.call(this, node, reference); }
        catch (error) {
          window.__insertBeforeDiagnostic = {
            message: error.message,
            host: this.id || this.className || this.tagName,
            reference: reference?.id || reference?.className || reference?.tagName || null,
            referenceParent: reference?.parentElement?.id || reference?.parentElement?.className || null,
          };
          throw error;
        }
      };
    });
    await page.route('**/api/stock/kline**', async route => {
      const url = new URL(route.request().url());
      const period = url.searchParams.get('period') || '1d';
      klinePeriods.push(period);
      const bars = [
        { time: Date.parse('2026-09-22T20:00:00.000Z'), open: 100, high: 104, low: 99, close: 103, volume: 1000 },
        { time: Date.parse('2026-09-23T20:00:00.000Z'), open: 103, high: 107, low: 102, close: 105, volume: 1200 },
        { time: Date.parse('2026-09-24T20:00:00.000Z'), open: 105, high: 109, low: 104, close: 108, volume: 1500 },
      ];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        success: true,
        market: 'stocks',
        instrument: `stock:us:${url.searchParams.get('api') || 'AAPL'}`,
        dataStatus: 'historical',
        source: 'Workspace experience browser fixture',
        updatedAt: '2026-09-25T01:00:00.000Z',
        timezone: 'America/New_York',
        data: bars,
      }) });
    });
    await page.route('**/api/instruments/compare**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: [{ id: 'stock:us:AAPL', type: 'stock', symbol: 'AAPL', title: 'Apple', quote: { price: 108 }, freshness: { status: 'historical', fetchedAt: '2026-09-25T01:00:00.000Z' } }],
      }) });
    });
    await page.route('**/api/watchlist**', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const url = new URL(route.request().url());
      const body = url.pathname === '/api/watchlist'
        ? { success: true, data: ['stock:us:AAPL'], ownerId: 'admin' }
        : { success: true, scope: 'watchlist', group: 'all', groups: [
          { id: 'watchlist', label: '我的自选', items: [{ instrumentId: 'stock:us:AAPL', title: 'AAPL', type: 'stock' }] },
          { id: 'paper', label: '模拟持仓', items: [] },
        ] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/workspace/watchlist**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      scope: 'watchlist',
      group: 'all',
      groups: [
        { id: 'watchlist', label: '我的自选', items: [{ instrumentId: 'stock:us:AAPL', title: 'AAPL', type: 'stock' }] },
        { id: 'paper', label: '模拟持仓', items: [] },
      ],
    }) }));

    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await Promise.all([
      page.waitForURL(url => url.pathname === '/', { timeout: 15_000 }),
      page.click('#submitBtn'),
    ]);
    await page.waitForFunction(() => Boolean(window.MoneyMoneyExperience?.installAlertHistoryPreview));
    await page.waitForSelector('[data-mm-resize="left"]');
    await page.waitForFunction(() => document.querySelector('.mm-digest-filters'), null, { timeout: 10_000 }).catch(async () => {
      const diagnostic = await page.evaluate(() => ({ readyState: document.readyState, section: Boolean(document.getElementById('market-change-digest')), list: Boolean(document.getElementById('market-change-digest-list')), status: Boolean(document.getElementById('market-change-digest-status')), script: [...document.scripts].some(item => item.src.includes('experience-enhancements.js')), bodyClasses: document.body.className, insertBefore: window.__insertBeforeDiagnostic }));
      throw new Error(`digest enhancement was not installed: ${JSON.stringify({ diagnostic, pageErrors })}`);
    });
    assert.equal(await page.locator('[data-mm-resize]').count(), 2, 'both resizable workspace boundaries should be present');

    await page.locator('#mm-layout-menu-toggle').click();
    await page.locator('[data-mm-density-value="compact"]').click();
    assert.equal(await page.locator('html').getAttribute('data-mm-density'), 'compact');
    await page.keyboard.press('Control+k');
    await page.locator('#global-search-overlay.open #mm-command-actions').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#mm-command-actions .mm-command-action').count() >= 10, 'command palette should expose real workspace actions');
    await page.keyboard.press('Escape');

    await page.evaluate(()=>{setMarketScope('stocks');openWorkspace('overview');});
    await page.evaluate(async () => {
      await marketChangeDigestPromise;
      renderMarketChangeDigest({ updatedAt: '2026-09-25T01:00:00.000Z', records: [
        { id: 'digest-price', market: 'stocks', kind: 'price-change', title: 'AAPL 行情变化', instrument: 'stock:us:AAPL' },
        { id: 'digest-event', market: 'stocks', kind: 'news', title: 'AAPL 新闻事件', instrument: 'stock:us:AAPL' },
        { id: 'digest-signal', market: 'crypto', kind: 'signal', title: 'BTC 信号' },
        { id: 'digest-13f', market: 'stocks', kind: '13f-change', title: 'AAPL 13F 变化' },
        { id: 'digest-source', market: 'options', kind: 'source-failure', title: '期权来源故障' },
      ] });
    });
    await page.locator('[data-mm-digest-filter="13f"]').click();
    assert.equal(await page.locator('#market-change-digest-list .market-change-digest-item:not([hidden])').count(), 1);
    assert.match(await page.locator('#market-change-digest-list .market-change-digest-item:not([hidden])').innerText(), /13F/);

    await page.evaluate(() => {
      setMarketScope('stocks');
      selectStockFromInstrumentLibrary('AAPL', 'Apple Inc.', 'AAPL');
    });
    await page.waitForFunction(() => document.querySelector('#stock-chart-title')?.textContent?.includes('AAPL'), null, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#stock-chart-card')?.getAttribute('aria-busy') !== 'true', null, { timeout: 10_000 });
    await page.locator('[data-chart-layout-toggle]').click();
    await page.locator('[data-stock-chart-companion]').waitFor({ state: 'visible' });
    await page.locator('[data-mm-multi-chart-toggle]').click();
    await page.locator('#mm-stock-multi-chart').waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll('#mm-stock-multi-chart [data-mm-multi-status]')].every(node => node.textContent.includes('根 · historical')), null, { timeout: 12_000 });
    for (const period of ['5m', '15m', '1h', '1d']) assert.ok(klinePeriods.includes(period), `multi-period chart should request ${period}`);
    await page.locator('#mm-stock-multi-chart [data-mm-multi-period="1d"] canvas').click({ position: { x: 80, y: 100 } });
    await page.waitForFunction(() => document.querySelector('[data-chart-candle-date]')?.value === '2026-09-22', null, { timeout: 10_000 });

    await page.evaluate(() => showTab('alerts'));
    await page.locator('#alert-symbol').fill('AAPL');
    await page.locator('#alert-direction').selectOption('ABOVE');
    await page.locator('#alert-price').fill('105');
    await page.locator('[data-mm-alert-history-preview]').click();
    await page.waitForFunction(() => document.querySelector('#mm-alert-history-preview')?.textContent.includes('历史 OHLC 命中'), null, { timeout: 10_000 });
    assert.match(await page.locator('#mm-alert-history-preview').innerText(), /2\/3 根日K/);
    assert.match(await page.locator('#mm-alert-history-preview').innerText(), /Workspace experience browser fixture/);
    assert.match(await page.locator('#mm-alert-history-preview').innerText(), /不会自动创建提醒/);
    console.log('Chromium checkpoint: chart and historical alert passed');

    const csrfPost = await page.evaluate(async () => {
      const token = decodeURIComponent(document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('mm_csrf='))?.slice('mm_csrf='.length) || '');
      const response = await fetch('/api/watchlist', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ instrumentId: 'stock:us:AAPL' }) });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(csrfPost.status, 200, JSON.stringify(csrfPost.body));
    console.log('Chromium checkpoint: owner CSRF write passed');
    await page.evaluate(() => setMarketScope('watchlist'));
    await page.evaluate(() => loadWorkspaceWatchlist(true));
    await page.locator('#workspace-watchlist-groups tr.workspace-watchlist-row[data-watchlist-instrument="stock:us:AAPL"]').waitFor({ state: 'visible', timeout: 10_000 }).catch(async () => {
      const diagnostic = await page.evaluate(() => ({ scope: activeMarketScope, workspace: activeWorkspaceId, positionsClass: document.getElementById('positions-tab')?.className, panelHidden: document.getElementById('workspace-watchlist-panel')?.hidden, host: document.getElementById('workspace-watchlist-groups')?.innerHTML, groups: workspaceWatchlistGroups, toolbar: document.querySelector('.mm-watchlist-toolbar')?.outerHTML, errors: window.__insertBeforeDiagnostic }));
      throw new Error(`watchlist rendered no row: ${JSON.stringify({ diagnostic, pageErrors })}`);
    });
    console.log('Chromium checkpoint: watchlist row visible');
    const watchlistSearch = page.locator('[data-mm-watchlist-search]');
    await watchlistSearch.fill('not-a-match');
    assert.equal(await page.locator('#workspace-watchlist-groups tr.workspace-watchlist-row[data-watchlist-instrument="stock:us:AAPL"]').isVisible(), false);
    await watchlistSearch.fill('AAPL');
    await page.locator('#workspace-watchlist-groups [data-mm-watchlist-select]').check();
    console.log('Chromium checkpoint: watchlist checkbox checked');
    assert.equal(await page.locator('[data-mm-watchlist-alert]').isEnabled(), true);
    await page.locator('[data-mm-watchlist-alert]').click();
    await page.locator('.mm-modal [data-mm-bulk-alert-save]').waitFor({ state: 'visible', timeout: 10_000 });
    console.log('Chromium checkpoint: bulk alert preview visible');
    const savedRule=page.waitForResponse(response=>response.url().endsWith('/api/alert-rules') && response.request().method()==='POST');
    await page.locator('.mm-modal [data-mm-bulk-alert-save]').click();
    const savedResponse=await savedRule;assert.equal(savedResponse.status(),201,JSON.stringify(await savedResponse.json()));
    await page.waitForFunction(async () => {
      const response = await fetch('/api/alert-rules');
      const body = await response.json();
      return body.data?.some(rule => rule.instrumentId === 'stock:us:AAPL');
    }, null, { timeout: 10_000 });
    console.log('Chromium checkpoint: batch alert persisted with CSRF');

    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-mm-watchlist-remove]').click();
    await page.locator('#mm-undo-toast').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#mm-undo-toast button').click();
    await page.locator('#workspace-watchlist-groups tr.workspace-watchlist-row[data-watchlist-instrument="stock:us:AAPL"]').waitFor({ state: 'visible', timeout: 10_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mm-mobile-library-toggle').click();
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('mm-library-drawer-open')), true);
    await page.locator('#mm-mobile-library-backdrop').click({ position: { x: 10, y: 100 }, force: true });
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('mm-library-drawer-open')), false);
    assert.deepEqual(pageErrors, []);
    console.log('Workspace experience Chromium smoke passed: layout resize/density, Ctrl+K actions, digest filtering, four-period Kline and date linkage, historical alert preview, CSRF-protected batch reminder, watchlist search/remove/undo, and mobile library drawer');
  } finally {
    if (browser) await browser.close();
    await stopServer();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
