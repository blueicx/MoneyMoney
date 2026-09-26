const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 3191;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(__dirname, '../dist/web/server.js')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_POLLING_ENABLED: 'false', AI_PAPER_TRADING_ENABLED: 'false', PRIVATE_KEY: '', API_KEY: '', MONEYMONEY_LOGIN_USER: 'matrix-owner', MONEYMONEY_LOGIN_PASS: 'local-matrix-test-only-92!', MONEYMONEY_JWT_SECRET: 'local-matrix-jwt-secret-0123456789abcdef' },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(base + '/api/health/live');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('local browser matrix server did not become healthy');
}

async function main() {
  let browser;
  let context;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = [];
    let settlementStatus = null;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('/api/prediction/settlement/')) settlementStatus = response.status();
    });
    await page.route('**/api/prediction/settlement/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        market: 'prediction',
        instrument: 'prediction:polymarket:12345',
        dataStatus: 'historical',
        source: 'https://gamma-api.polymarket.com/markets/12345',
        updatedAt: '2026-09-26T12:00:00.000Z',
        reason: '未提供可核实的最终结果；不会根据概率或收盘价格推断结算。',
        data: { market: 'prediction', instrument: 'prediction:polymarket:12345', platform: 'Polymarket', marketId: '12345', status: 'closed', result: null, rulesText: 'Resolution: use the cited official source.', rulesHash: 'rule-hash', resolutionSourceUrl: 'https://example.org/settlement', closeAt: '2026-09-25T12:00:00.000Z', determinationAt: null, settlementAt: null, capturedAt: '2026-09-26T12:00:00.000Z', sourceUrl: 'https://gamma-api.polymarket.com/markets/12345', evidenceHash: 'evidence-hash', reason: '未提供可核实的最终结果；不会根据概率或收盘价格推断结算。' },
        history: [],
      }),
    }));
    await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#username', 'matrix-owner');
    await page.fill('#password', 'local-matrix-test-only-92!');
    await Promise.all([page.waitForURL(url => url.pathname === '/', { timeout: 15_000 }), page.click('#submitBtn')]);
    await page.waitForSelector('#market-workspace-shell');
    for (const market of ['stocks', 'options', 'crypto', 'prediction']) {
      await page.evaluate(scope => setMarketScope(scope), market);
      await page.waitForFunction(scope => document.body.dataset.marketScope === scope, market);
      const state = await page.locator('#market-workspace-shell').getAttribute('data-market-scope');
      assert.equal(state, market);
      const library = market === 'stocks' ? '#stock-instrument-library' : `[data-market-library="${market}"]`;
      await page.locator(library).waitFor({ state: 'visible', timeout: 10_000 });
    }
    await page.evaluate(() => setMarketScope('options'));
    await page.locator('#options-library-quick .stock-library-item').first().click();
    assert.equal((await page.locator('#options-library-current-symbol').innerText()).trim(), 'SPY');
    assert.equal(await page.locator('#option-symbol').inputValue(), 'SPY');
    await page.evaluate(() => setMarketScope('crypto'));
    await page.locator('#crypto-library-quick .stock-library-item').first().click();
    assert.ok((await page.locator('#crypto-library-current-symbol').innerText()).trim() !== '--');
    await page.evaluate(() => setMarketScope('prediction'));
    await page.waitForFunction(() => !document.querySelector('#prediction-library-quick')?.textContent?.includes('正在读取'), null, { timeout: 30_000 });
    assert.ok((await page.locator('#prediction-library-quick').innerText()).trim());
    await page.evaluate(() => {
      predictionRadarState.loading = true;
      window.openWorkspace('prediction-radar');
      predictionRadarState.data = {
        updatedAt: new Date().toISOString(), markets: [{ platform: 'Polymarket', id: '12345', title: 'Settlement evidence test', category: 'Test', group: '综合', outcome: 'YES', yesPrice: 0.6, noPrice: 0.4, volume24h: 0, volumeTotal: 0, liquidity: 2000, activityScore: 1, internalEdge: 0, modelProbability: 0.58, probabilityConfidence: 50, probabilityZh: '测试' }], opportunities: [], sources: {},
      };
      renderPredictionRadar();
    });
    await page.locator('#radar-markets .radar-card').getByRole('button', { name: /结算证据/ }).click();
    const settlement = page.locator('#radar-markets .radar-card [id^="radar-settlement-"]');
    await settlement.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const panel = document.querySelector('#radar-markets [id^="radar-settlement-"]');
      return panel && !panel.textContent.includes('正在读取官方结算规则与证据');
    }, null, { timeout: 12_000 });
    assert.equal(settlementStatus, 200, await settlement.innerText());
    assert.match(await settlement.innerText(), /official source|最终结果/);
    await page.evaluate(() => setMarketScope('stocks'));
    await page.waitForSelector('#stock-library-quick .stock-library-item');
    await page.locator('#stock-library-quick .stock-library-item').first().click();
    const selected = (await page.locator('#stock-library-current-symbol').innerText()).trim();
    assert.ok(selected);
    await page.waitForFunction(symbol => document.querySelector('#stock-chart-title')?.textContent?.includes(symbol), selected, { timeout: 10_000 });
    const events = await page.evaluate(async symbol => {
      const response = await fetch('/api/events/entities?market=stocks&instrumentId=stock:us:' + encodeURIComponent(symbol));
      return { status: response.status, body: await response.json() };
    }, selected);
    assert.equal(events.status, 200);
    assert.ok(Array.isArray(events.body.data));
    assert.ok(events.body.data.length || events.body.reason);
    assert.ok(events.body.data.every(item => item.instrument === `stock:us:${selected}`));
    await page.locator('#stock-library-search-input').fill('SNDK');
    await page.locator('#stock-library-search-input').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#stock-library-search-results')?.textContent?.includes('搜索中'), null, { timeout: 30_000 });
    const searchResults = page.locator('#stock-library-search-results .stock-library-search-result');
    if (await searchResults.count()) {
      await searchResults.first().click();
      assert.match(await page.locator('#stock-chart-title').innerText(), /SNDK/i);
    } else {
      assert.match(await page.locator('#stock-library-search-results').innerText(), /没有找到|失败|不可用/);
    }
    await page.evaluate(() => renderEventStudyResult({
      market: 'stocks', instrument: 'SNDK', title: 'Quarterly earnings', eventAt: '2026-09-01T00:00:00.000Z',
      eventBar: { close: 100 }, window: { length: 21 }, rawReturnPct: 1.2, mfePct: 2.4, maePct: -0.8, recoveryBars: 4,
      cohort: { category: 'earnings', sampleSize: 6, meanReturnPct: 1.1, medianReturnPct: 0.9, confidence95Pct: [0.1, 2.2], benchmarkAdjustedMeanPct: 0.5, placebo: { sampleSize: 6, meanReturnPct: 0.2 } },
      warnings: [], disclaimer: '历史统计，不是预测。',
    }, null));
    const eventStudyText = await page.locator('#event-study-result').textContent();
    assert.match(eventStudyText, /同类历史事件/);
    assert.match(eventStudyText, /95% Bootstrap 区间/);
    await page.evaluate(() => toggleRightLibrary());
    assert.equal(await page.locator('#market-workspace-shell').getAttribute('data-right-library'), 'collapsed');
    await page.evaluate(() => toggleRightLibrary());
    assert.notEqual(await page.locator('#market-workspace-shell').getAttribute('data-right-library'), 'collapsed');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#center-workspace').isVisible(), true);
    assert.deepEqual(pageErrors, []);
    console.log('Browser market matrix passed: four scopes, popular/non-popular stocks, options/crypto selection, prediction event source or explicit reason, event evidence, collapse/restore, mobile center, no page errors');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT');
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
