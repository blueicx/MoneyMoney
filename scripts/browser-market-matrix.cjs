const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { chromium } = require('playwright');

const port = 3191;
const base = `http://127.0.0.1:${port}`;
const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-browser-matrix-'));
const child = spawn(process.execPath, [path.join(__dirname, '../dist/web/server.js')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, MONEYMONEY_DATA_DIR: isolatedDataDir, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_POLLING_ENABLED: 'false', AI_PAPER_TRADING_ENABLED: 'false', MONEYMONEY_DISABLE_GURU_REFRESH: 'true', PRIVATE_KEY: '', API_KEY: '', MONEYMONEY_LOGIN_USER: 'matrix-owner', MONEYMONEY_LOGIN_PASS: 'local-matrix-test-only-92!', MONEYMONEY_JWT_SECRET: 'local-matrix-jwt-secret-0123456789abcdef' },
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
    const klineRequests = [];
    let preflightReady = false;
    let backtestRuns = 0;
    let retryDeliveryCount = 0;
    let acknowledgeDeliveryCount = 0;
    const alertRows = [
      { id: 'delivery-browser-sent', alertId: 'alert-browser-sent', status: 'sent', deliveredAt: '2026-09-27T07:00:00.000Z', attempts: 1, channel: 'web', context: { market: 'stocks', workspace: 'alerts', instrument: 'stock:us:AAPL', timeframe: '1d' }, payload: { message: 'AAPL 测试提醒' } },
      { id: 'delivery-browser-failed', alertId: 'alert-browser-failed', status: 'failed', attempts: 2, lastError: '临时网络错误', channel: 'telegram', context: { market: 'stocks', workspace: 'alerts', instrument: 'stock:us:AAPL', timeframe: '1d' }, payload: { message: '失败提醒' } },
      { id: 'delivery-browser-queued', alertId: 'alert-browser-queued', status: 'queued', attempts: 1, channel: 'web', context: { market: 'stocks', workspace: 'alerts', instrument: 'stock:us:AAPL', timeframe: '1d' }, payload: { message: '排队提醒' } },
      { id: 'delivery-browser-suppressed', alertId: 'alert-browser-suppressed', status: 'suppressed', attempts: 0, channel: 'telegram', context: { market: 'stocks', workspace: 'alerts', instrument: 'stock:us:AAPL', timeframe: '1d' }, payload: { message: '静默时段提醒' } },
    ];
    const dailyBars = [
      { time: Date.parse('2026-09-22T20:00:00.000Z'), open: 100, high: 104, low: 99, close: 103, volume: 1000 },
      { time: Date.parse('2026-09-23T20:00:00.000Z'), open: 103, high: 106, low: 102, close: 105, volume: 1200 },
      { time: Date.parse('2026-09-24T20:00:00.000Z'), open: 105, high: 109, low: 104, close: 108, volume: 1500 },
    ];
    await page.route('**/api/stock/kline**', async route => {
      const url = new URL(route.request().url());
      const period = url.searchParams.get('period') || '1d';
      const date = url.searchParams.get('date');
      klineRequests.push({ period, date, intradayPeriod: url.searchParams.get('intradayPeriod'), symbol: url.searchParams.get('symbol'), api: url.searchParams.get('api') });
      if (period === '15m') await new Promise(resolve => setTimeout(resolve, 450));
      const day = date || '2026-09-24';
      const bars = date
        ? [
          { time: Date.parse(`${day}T14:30:00.000Z`), open: 105, high: 106, low: 104, close: 105, volume: 200 },
          { time: Date.parse(`${day}T14:35:00.000Z`), open: 105, high: 108, low: 105, close: 107, volume: 260 },
          { time: Date.parse(`${day}T14:40:00.000Z`), open: 107, high: 109, low: 106, close: 108, volume: 320 },
        ]
        : dailyBars;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        success: true, market: 'stocks', instrument: `stock:us:${url.searchParams.get('api') || 'AAPL'}`, dataStatus: 'historical',
        source: 'Browser acceptance fixture', updatedAt: '2026-09-27T08:00:00.000Z', timezone: 'America/New_York',
        session: date ? { date, previousDate: '2026-09-23', nextDate: '2026-09-25', dataWindow: { firstBarLocalTime: '09:30', lastBarLocalTime: '09:40', bars: 3, note: '来源K线覆盖时段，不代表完整交易所交易时段' }, ohlc: { open: 105, high: 109, low: 104, close: 108, volume: 780 } } : null,
        data: bars,
      }) });
    });
    await page.route('**/api/stocks/guru-holdings/**', async route => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts.at(-1);
      const secUrl = 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/infotable.xml';
      let payload;
      if (last === 'managers') {
        payload = { market: 'stocks', dataStatus: 'historical', source: 'SEC EDGAR CIK fixture', updatedAt: '2026-09-29T01:00:00.000Z', reason: null, evidenceRefs: [], data: [{ cik: '0001067983', filingName: 'Berkshire Hathaway Inc.', personAssociation: 'Warren Buffett', dataStatus: 'cached', reportPeriod: '2026-06-30', filedAt: '2026-08-14' }] };
      } else if (last === '0001067983') {
        payload = { market: 'stocks', instrument: null, dataStatus: 'cached', source: 'SEC EDGAR Form 13F', updatedAt: '2026-09-29T01:00:00.000Z', reason: null, evidenceRefs: [secUrl], manager: { cik: '0001067983', filingName: 'Berkshire Hathaway Inc.', personAssociation: 'Warren Buffett', attributionNote: '公开关联人物；SEC 申报主体仍为公司' }, latestReport: { reportPeriod: '2026-06-30', filedAt: '2026-08-14', informationTableUrl: secUrl, positions: [{ issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100', putCall: null, shares: 150, reportedValueUsd: 125000 }] }, previousReport: null, changes: [{ issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100', putCall: null, currentShares: 150, previousShares: null, shareDelta: null, change: 'newly-disclosed' }], caveats: ['季度披露，非实时持仓。'] };
      } else if (last === 'SNDK') {
        payload = { market: 'stocks', instrument: 'SNDK', dataStatus: 'unavailable', source: 'SEC CUSIP/class registry', updatedAt: null, reason: '该股票尚无已核验的 SEC CUSIP 与证券类别映射，不能按公司名称猜测持仓。', evidenceRefs: [], mapping: null, holders: [], caveats: ['13F 报告期持仓，不是实时持仓。'] };
      } else {
        payload = { market: 'stocks', instrument: 'AAPL', dataStatus: 'cached', source: 'SEC EDGAR Form 13F fixture', updatedAt: '2026-09-29T01:00:00.000Z', reason: null, evidenceRefs: [secUrl], mapping: { cusip: '037833100', classTitle: 'COM', issuerName: 'Apple Inc.' }, holders: [{ manager: { cik: '0001067983', filingName: 'Berkshire Hathaway Inc.', personAssociation: 'Warren Buffett' }, reportPeriod: '2026-06-30', filedAt: '2026-08-14', sourceUrl: secUrl, shares: 150, reportedValueUsd: 125000, portfolioWeightPct: 1.25, previousShares: 100, shareDelta: 50, change: 'increased' }], caveats: ['13F 报告期持仓，不是实时持仓。'] };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.route('**/api/stock/market-breadth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { generatedAt: '2026-09-29T01:00:00.000Z', gainers: [{ symbol: 'SNDK', name: 'Fixture Semiconductor', changePct: 4.2 }], losers: [{ symbol: 'TEST', name: 'Fixture Test Inc.', changePct: -2.1 }] } }) }));
    await page.route('**/api/workspace/watchlist**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, groups: [{ id: 'watchlist', label: '我的自选', items: [{ instrumentId: 'stock:us:FIX', title: 'Fixture Watchlist' }] }] }) }));
    await page.route('**/api/backtest/preflight**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: preflightReady, market: 'stocks', instrument: 'AAPL', timeframe: '1d', dataStatus: preflightReady ? 'ready' : 'insufficient',
      source: 'Browser acceptance fixture', sourceStatus: 'live', updatedAt: '2026-09-27T08:00:00.000Z', availableBars: preflightReady ? 40 : 6,
      requiredBars: 16, dataRange: { from: '2026-07-01T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z' },
      calendarNote: '仅报告数据源实际返回的K线，不推断节假日、休市或缺失交易日。', reason: preflightReady ? null : '来源K线不足',
    }) }));
    await page.route('**/api/backtest?*', route => {
      backtestRuns += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, scope: 'stocks', data: {
        availability: 'ready', market: 'stocks', instrumentId: 'AAPL', dataSource: 'Browser acceptance fixture', dataSnapshotHash: 'a'.repeat(64), strategyVersion: 'asset-backtest-v1',
        barCount: 40, startTime: Date.parse('2026-07-01T00:00:00.000Z'), endTime: Date.parse('2026-09-27T00:00:00.000Z'), totalTrades: 1, winningTrades: 1, losingTrades: 0,
        winRate: 1, totalReturnPct: 1.2, maxDrawdownPct: 0.4, sharpeRatio: 1.1, trades: [{ instrumentId: 'AAPL', side: 'long', entryPrice: 100, exitPrice: 102, entryTime: Date.parse('2026-09-01T00:00:00.000Z'), exitTime: Date.parse('2026-09-05T00:00:00.000Z'), pnlPct: 1.2 }],
        equityCurve: [{ time: Date.parse('2026-07-01T00:00:00.000Z'), equity: 1000 }, { time: Date.parse('2026-09-27T00:00:00.000Z'), equity: 1012 }],
        metrics: { cagrPct: 5, sortinoRatio: 1.2, profitFactor: 2, turnoverPct: 5, feesImpactPct: 0.1, slippageImpactPct: 0.1, benchmarkDiffPct: 0.2 },
        assumptions: { session: 'US regular session', settlement: 'T+1', positionPct: 5, feesBps: 10, slippageBps: 5 },
      } }) });
    });
    await page.route('**/api/equity-options/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      market: 'us_equity', asset: 'SPY', source: 'CBOE browser fixture', fetchedAt: '2026-09-27T08:00:00.000Z', spot: 500,
      totalCallOpenInterest: 1000, totalPutOpenInterest: 900, totalPutCallOIRatio: 0.9,
      quote: { change: 1, changePercent: 0.2, volume: 10000, iv30Pct: 18 },
      expiries: [{ expiryMs: Date.parse('2026-10-16T00:00:00.000Z'), label: '2026-10-16', daysToExpiry: 19,
        rows: [
          { instrumentName: 'SPY-C-500', strike: 500, optionType: 'call', markPrice: 2, premiumUsd: 200, impliedVolPct: 18, bidPrice: 1.9, askPrice: 2.1, spreadPct: 10, volume: 200, volumeUsd: 40000, openInterest: 800, delta: 0.5, quoteQuality: { status: 'quoted', label: '双边报价可见', referenceAsk: 2.1, referenceBid: 1.9 } },
          { instrumentName: 'SPY-P-500', strike: 500, optionType: 'put', markPrice: 3, premiumUsd: 300, impliedVolPct: 22, bidPrice: 1, askPrice: 2, spreadPct: 66.7, volume: 1, volumeUsd: 300, openInterest: 2, delta: -0.5, quoteQuality: { status: 'wide-spread', label: '价差过宽', referenceAsk: 2, referenceBid: 1 } },
        ], callOpenInterest: 800, putOpenInterest: 2, callVolume: 200, putVolume: 1, putCallOIRatio: 0.01, putCallVolumeRatio: 0.005, maxPainStrike: 500, strategyIdeas: [] }],
    } }) }));
    await page.route('**/api/instruments/compare?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [
      { id: 'stock:us:AAPL', type: 'stock', symbol: 'AAPL', title: 'Apple', quote: { price: 250, changePct: 1.25 }, freshness: { status: 'fresh', fetchedAt: '2026-09-27T08:00:00.000Z' }, sourceStatus: { nasdaq: 'live' } },
      { id: 'stock:us:MSFT', type: 'stock', symbol: 'MSFT', title: 'Microsoft', quote: { price: null, changePct: null }, freshness: { status: 'unavailable', fetchedAt: null }, sourceStatus: { nasdaq: 'unavailable' } },
    ] }) }));
    await page.route('**/api/screener?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { market: 'stocks', fields: [], rows: [], page: 1, pageSize: 50, total: 0, reason: '浏览器验收使用的空筛选集' } }) }));
    await page.route('**/api/data/slo?**', route => {
      const market = new URL(route.request().url()).searchParams.get('market');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, market, sources: [{
        sourceId: 'fixture', sourceName: '验收数据源', responseSuccessPct: 90, available: 9, checks: 10,
        dataCoveragePct: 66.67, consecutiveEmpty: 2, latestDataAt: '2026-09-27T07:00:00.000Z', dataFreshnessSeconds: 3600, latestSuccessAt: '2026-09-27T07:01:00.000Z',
      }], coverage: [], dataStatus: 'historical', source: 'Browser acceptance fixture', updatedAt: '2026-09-27T08:00:00.000Z' }) });
    });
    await page.route('**/api/source-health', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      updatedAt: '2026-09-27T08:00:00.000Z', total: 1, online: 1, items: [{ id: 'fixture', name: '验收源', group: '测试', ok: true, latencyMs: 20, detail: '正常', status: 'live', capabilities: ['quote'] }],
    } }) }));
    let alertFeedback = null;
    await page.route('**/api/research/freshness**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { status: 'current', findings: [], reason: '已固定数据快照，未发现后续修订。' } }) }));
    await page.route('**/api/alerts/deliveries**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.pathname.endsWith('/feedback')) {
        alertFeedback = request.postDataJSON().rating;
        const id = decodeURIComponent(url.pathname.split('/').at(-2));
        const row = alertRows.find(item => item.id === id);
        if (row) row.feedback = { rating: alertFeedback, at: '2026-09-27T08:00:00.000Z' };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: row || { id, status: 'sent', feedback: { rating: alertFeedback, at: '2026-09-27T08:00:00.000Z' } } }) });
      }
      if (request.method() === 'POST' && url.pathname.endsWith('/retry')) {
        retryDeliveryCount += 1;
        const id = decodeURIComponent(url.pathname.split('/').at(-2));
        const row = alertRows.find(item => item.id === id);
        if (row) { row.status = 'sent'; row.attempts += 1; row.deliveredAt = '2026-09-27T08:01:00.000Z'; row.lastError = null; }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: row }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: alertRows }) });
    });
    await page.route('**/api/alerts/**/ack', async route => {
      acknowledgeDeliveryCount += 1;
      const url = new URL(route.request().url());
      const deliveryId = decodeURIComponent(url.pathname.split('/').at(-2));
      const row = alertRows.find(item => item.id === deliveryId);
      if (row) row.status = 'acknowledged';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: row || { id: deliveryId, status: 'acknowledged' } }) });
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
    await page.waitForFunction(() => window.mm_authReady && window.mm_isLoggedIn === true, null, { timeout: 10_000 });
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
    await page.evaluate(() => setMarketScope('options'));
    assert.equal(await page.locator('#options-tab').isVisible(), true, 'options workspace must open with the options market');
    assert.equal(await page.evaluate(() => activeWorkspaceId), 'option-chain');
    await page.evaluate(() => { document.getElementById('option-market').value = 'us'; setOptionMarket('us'); });
    await page.locator('#option-chain table').waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await page.locator('#option-chain').innerText(), /双边报价可见/);
    assert.match(await page.locator('#option-chain').innerText(), /价差过宽/);
    assert.match(await page.locator('#options-updated').innerText(), /不等于合约逐笔报价时间/);
    await page.evaluate(() => setMarketScope('stocks'));
    await page.waitForSelector('#stock-library-quick .stock-library-item');
    await page.locator('#stock-library-quick .stock-library-item').first().click();
    const selected = (await page.locator('#stock-library-current-symbol').innerText()).trim();
    assert.ok(selected);
    await page.waitForFunction(symbol => document.querySelector('#stock-chart-title')?.textContent?.includes(symbol), selected, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#stock-kline')?.style.visibility === 'visible', null, { timeout: 10_000 });
    assert.match(await page.locator('#stock-chart-data-status').innerText(), /历史时点数据/);
    assert.match(await page.locator('#stock-chart-data-status').innerText(), /Browser acceptance fixture/);
    await page.locator('[data-kline-period="15m"]').click();
    await page.waitForFunction(() => document.querySelector('#stock-chart-card')?.getAttribute('aria-busy') === 'true', null, { timeout: 5_000 });
    assert.equal(await page.locator('#stock-kline').evaluate(canvas => getComputedStyle(canvas).visibility), 'hidden', 'old-period chart must not remain visible while loading');
    await page.waitForFunction(() => document.querySelector('#stock-chart-card')?.getAttribute('aria-busy') !== 'true', null, { timeout: 10_000 });
    assert.equal(await page.locator('#stock-kline').evaluate(canvas => getComputedStyle(canvas).visibility), 'visible');
    await page.locator('[data-kline-period="1d"]').click();
    await page.waitForFunction(() => document.querySelector('#stock-chart-card')?.getAttribute('aria-busy') !== 'true', null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => focusStockKlineDate('2026-09-24')), 2);
    assert.equal(await page.locator('[data-chart-candle-date]').inputValue(), '2026-09-24', 'daily chart selection and date input must use the same session date');
    await page.locator('[data-chart-candle-focus]').click();
    await page.waitForFunction(() => document.querySelector('[data-intraday-controls]')?.hidden === false, null, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#stock-chart-card')?.getAttribute('aria-busy') !== 'true', null, { timeout: 10_000 });
    assert.ok(klineRequests.some(item => item.date === '2026-09-24' && item.intradayPeriod === '5m'));
    assert.match(await page.locator('#stock-chart-data-status').innerText(), /2026-09-24.*5m.*America\/New_York/);
    await page.locator('.intraday-period[data-intraday-period="1m"]').click();
    await page.waitForFunction(() => document.querySelector('#stock-chart-card')?.getAttribute('aria-busy') !== 'true', null, { timeout: 10_000 });
    assert.ok(klineRequests.some(item => item.date === '2026-09-24' && item.intradayPeriod === '1m'));
    assert.match(await page.locator('#stock-chart-data-status').innerText(), /来源覆盖 09:30–09:40/);
    await page.locator('[data-chart-candle-focus]').click();
    await page.waitForFunction(() => document.querySelector('[data-intraday-controls]')?.hidden === true, null, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#stock-chart-candle-selection')?.textContent?.includes('2026-09-24'), null, { timeout: 10_000 });
    assert.match(await page.locator('#stock-chart-candle-selection').innerText(), /2026-09-24/);
    await page.locator('[data-chart-layout-toggle]').click();
    await page.locator('[data-stock-chart-companion]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-stock-chart-companion-status]')?.textContent?.includes('Browser acceptance fixture'), null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('mm-stock-chart-layout-v1')), 'open');
    const companionPreferences = await page.evaluate(() => JSON.parse(localStorage.getItem('mm-stock-chart-companion-v1')));
    assert.equal(companionPreferences.period, '1h');
    assert.ok(klineRequests.some(item => item.period === '1h' && item.symbol === 'usAAPL'), 'companion chart should use the selected stock in its own period');
    const companion = page.locator('#stock-kline-companion');
    await companion.click({ position: { x: 105, y: 110 } });
    await page.waitForFunction(() => document.querySelector('[data-chart-candle-date]')?.value === '2026-09-22', null, { timeout: 10_000 });
    await page.locator('[data-chart-companion-mode]').selectOption('benchmark');
    await page.waitForFunction(() => document.querySelector('[data-stock-chart-companion-status]')?.textContent?.includes('SPY基准'), null, { timeout: 10_000 });
    assert.ok(klineRequests.some(item => item.api === 'SPY' && item.symbol === 'usSPY'), 'benchmark chart must route to the stock benchmark only');
    await page.evaluate(() => openWorkspace('screener'));
    await page.locator('#market-compare-ids').waitFor({ state: 'visible' });
    await page.locator('#market-compare-ids').fill('stock:us:AAPL,stock:us:MSFT');
    await page.evaluate(() => loadMarketCompare());
    await page.waitForFunction(() => document.querySelector('#market-compare-results')?.textContent?.includes('Microsoft'));
    assert.match(await page.locator('#market-compare-results').innerText(), /\+1\.25%/);
    assert.match(await page.locator('#market-compare-results').innerText(), /暂无涨跌/);
    assert.match(await page.locator('#market-compare-results').innerText(), /nasdaq: live/);
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
    await page.evaluate(() => selectStockFromInstrumentLibrary('SNDK', 'Fixture Semiconductor', 'SNDK'));
    await page.locator('#workspace-sidebar-content [data-workspace-id="guru-holdings"]').click();
    await page.locator('#guru-holdings-tab').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content')?.textContent?.includes('SEC'), null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => guruHoldingsView), 'stocks', 'selecting a stock in the right library should open the stock-holder view');
    await page.locator('[data-guru-view="managers"]').click();
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content')?.textContent?.includes('Warren Buffett'), null, { timeout: 10_000 });
    await page.locator('[data-guru-manager-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content')?.textContent?.includes('报告期截至'), null, { timeout: 10_000 });
    assert.match(await page.locator('#guru-holdings-content').innerText(), /2026-06-30/);
    assert.match(await page.locator('#guru-holdings-content').innerText(), /查看 SEC 原文申报/);
    assert.match(await page.locator('#guru-holdings-content a').getAttribute('href'), /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
    await page.locator('[data-guru-view="stocks"]').click();
    await page.locator('[data-guru-stock="SNDK"]').click();
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content')?.textContent?.includes('不能按公司名称猜测持仓'), null, { timeout: 10_000 });
    await page.locator('#guru-holdings-search').fill('AAPL');
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content tbody tr')?.textContent?.includes('Warren Buffett'), null, { timeout: 10_000 });
    assert.match(await page.locator('#guru-holdings-content').innerText(), /股数变化/);
    await page.locator('#guru-holdings-content [data-guru-cik="0001067983"]').click();
    await page.waitForFunction(() => document.querySelector('#guru-holdings-content')?.textContent?.includes('申报证券'), null, { timeout: 10_000 });
    await page.evaluate(() => setMarketScope('options'));
    assert.equal(await page.locator('#workspace-sidebar-content [data-workspace-id="guru-holdings"]').count(), 0, 'guru holdings must not appear in options navigation');
    assert.equal(await page.locator('#guru-holdings-tab').isVisible(), false, 'guru holdings panel must be hidden outside stocks');
    await page.evaluate(() => setMarketScope('stocks'));
    await page.evaluate(() => showTab('backtest'));
    await page.locator('#bt-market-id').fill('AAPL');
    await page.evaluate(() => runBacktest());
    await page.waitForFunction(() => document.querySelector('#backtest-data-preflight')?.textContent?.includes('数据预检未通过'), null, { timeout: 10_000 });
    assert.equal(backtestRuns, 0, 'backtest must not run when the market-scoped data preflight fails');
    preflightReady = true;
    await page.evaluate(() => runBacktest());
    await page.waitForFunction(() => document.querySelector('#backtest-results')?.textContent?.includes('指标定义与本次输入口径'), null, { timeout: 10_000 });
    assert.equal(backtestRuns, 1);
    assert.match(await page.locator('#backtest-results').innerText(), /Browser acceptance fixture/);
    assert.match(await page.locator('#backtest-results').innerText(), /252日年化/);
    await page.evaluate(() => saveBacktestCandidate());
    await page.locator('[data-candidate-freshness="0"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-candidate-freshness="0"]')?.dataset.status === 'current', null, { timeout: 10_000 });
    await page.locator('#backtest-candidates button').filter({ hasText: '人工复跑' }).click();
    await page.waitForFunction(() => document.querySelector('#backtest-results')?.textContent?.includes('指标定义与本次输入口径'), null, { timeout: 10_000 });
    assert.equal(backtestRuns, 2, 'candidate manual rerun should create a fresh backtest only after preflight');
    await page.evaluate(() => toggleRightLibrary());
    assert.equal(await page.locator('#market-workspace-shell').getAttribute('data-right-library'), 'collapsed');
    await page.evaluate(() => toggleRightLibrary());
    assert.notEqual(await page.locator('#market-workspace-shell').getAttribute('data-right-library'), 'collapsed');
    await page.evaluate(() => showTab('alerts'));
    await page.waitForFunction(() => document.querySelector('[data-alert-delivery-management]')?.textContent?.includes('投递失败'));
    assert.match(await page.locator('[data-alert-delivery-management]').innerText(), /已抑制/);
    await page.locator('[data-alert-delivery-management] button').filter({ hasText: '重试投递' }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-alert-delivery-management]')?.textContent?.includes('已发送'), null, { timeout: 10_000 });
    assert.equal(retryDeliveryCount, 1);
    await page.locator('[data-alert-delivery-management] button').filter({ hasText: '确认已读' }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-alert-delivery-management]')?.textContent?.includes('已确认'), null, { timeout: 10_000 });
    assert.equal(acknowledgeDeliveryCount, 1);
    await page.locator('#alerts-list button').filter({ hasText: '有用' }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-alert-delivery-management]')?.textContent?.includes('反馈：有用'));
    assert.equal(alertFeedback, 'useful');
    await page.evaluate(() => showTab('settings'));
    await page.waitForFunction(() => document.querySelector('#source-slo-panel')?.textContent?.includes('接口成功率与实际数据覆盖'), null, { timeout: 10_000 });
    assert.match(await page.locator('#source-slo-panel').innerText(), /连续空结果 2/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#center-workspace').isVisible(), true);
    assert.deepEqual(pageErrors, []);
    console.log('Browser market matrix passed: four scopes, SEC 13F manager/stock views and source links, strict guru market isolation, options quote-quality cells, chart freshness/date drilldown/coverage, synchronized companion and same-market SPY comparison, data-preflight-blocked backtest/candidate freshness/manual rerun, alert retry/ACK/feedback, SLO, prediction evidence, collapse/restore, mobile center, no page errors');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT');
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
