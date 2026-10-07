const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { chromium } = require('playwright');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-live-kline-')), base = 'http://127.0.0.1:3197';
const child = spawn(process.execPath, ['dist/web/server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env,
  MONEYMONEY_DATA_DIR: data, APP_HOST: '127.0.0.1', APP_PORT: '3197', MONEYMONEY_LOGIN_USER: 'live-fixture-owner', MONEYMONEY_LOGIN_PASS: 'isolated-live-fixture-password', MONEYMONEY_JWT_SECRET: 'isolated-live-fixture-secret-1234567890',
  TELEGRAM_NETWORK_ENABLED: 'false', TELEGRAM_POLLING_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', TELEGRAM_ALLOWED_CHAT_IDS: '', TELEGRAM_ADMIN_CHAT_IDS: '', WECOM_WEBHOOK_URL: '', BARK_DEVICE_KEY: '',
  OPENROUTER_API_KEY: '', DISCORD_WEBHOOK_URL: '', LARK_WEBHOOK_URL: '', MONEYMONEY_WEBHOOK_URL: '', MONEYMONEY_DISABLE_GURU_REFRESH: 'true', MONEYMONEY_KLINE_STREAM_ENABLED: 'false', AI_PAPER_TRADING_ENABLED: 'false', PRIVATE_KEY: '', API_KEY: '' } });
async function main() {
  let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health/live')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Replace only SSE transport. Production controller and chart drawing run unchanged.
    await page.addInitScript(() => {
      window.__fixtureStreams = [];
      window.EventSource = class extends EventTarget { constructor(url) { super(); this.url = url; this.closed = false; window.__fixtureStreams.push(this); } close() { this.closed = true; } };
    });
    const start = Math.floor(Date.now() / 300000) * 300000;
    const rows = Array.from({ length: 35 }, (_, i) => ({ time: start - (34 - i) * 300000, open: 100, high: 105, low: 95, close: 101, volume: 5 }));
    let requests = 0;
    await page.route('**/api/stock/kline?**', route => { requests++; return route.fulfill({ json: { success: true, data: rows, source: 'Isolated chart fixture, not market data', updatedAt: new Date().toISOString(), dataStatus: 'delayed' } }); });
    await page.route('**/api/binance/klines?**', route => route.fulfill({ json: { success: true, data: rows, source: 'Isolated chart fixture', updatedAt: new Date().toISOString(), dataStatus: 'delayed' } }));
    await page.goto(base + '/login'); await page.fill('#username', 'live-fixture-owner'); await page.fill('#password', 'isolated-live-fixture-password');
    await Promise.all([page.waitForURL(url => url.pathname === '/'), page.click('#submitBtn')]);
    await page.waitForFunction(() => window.mm_isLoggedIn && window.MoneyLiveKline);
    await page.evaluate(async () => { setMarketScope('stocks'); openWorkspace('stock-quotes'); await loadStockKline('usAAPL', 'Apple', ''); });
    await page.locator('#stock-chart-card').waitFor({ state: 'visible' });
    await page.waitForFunction(() => stockChartKlines.length > 10 && document.getElementById('stock-chart-card').getAttribute('aria-busy') !== 'true');
    const focus = await page.evaluate(async () => { stockChartFocusIndex = 10; stockChartFocusEnabled = true; const time = stockChartKlines[10].time; window.__unifiedCalls = 0; const original = loadUnifiedStockData; loadUnifiedStockData = (...args) => { window.__unifiedCalls++; return original(...args); }; await loadStockKline(undefined, undefined, undefined, { live: true }); return { expected: time, actual: stockChartKlines[stockChartFocusIndex].time, focus: stockChartFocusEnabled, extraCalls: window.__unifiedCalls }; });
    assert.equal(focus.actual, focus.expected); assert.equal(focus.focus, true); assert.equal(focus.extraCalls, 0);
    const before = requests;
    await page.evaluate(async () => { stepStockChartReplay('previous'); await loadStockKline(undefined, undefined, undefined, { live: true }); });
    assert.equal(requests, before, 'Replay must block live reads');
    await page.evaluate(async () => { stepStockChartReplay('next'); stockChartAsOf = '2026-01-01'; MoneyLiveKline.sync(); await loadStockKline(undefined, undefined, undefined, { live: true }); });
    assert.equal(requests, before, 'asOf must block live reads');
    await page.evaluate(async () => { stockChartAsOf = ''; setMarketScope('crypto'); openWorkspace('crypto-quotes'); bnCurrentSymbol = 'BTCUSDT'; bnCurrentInterval = '5m'; await loadBinanceKlines(); MoneyLiveKline.sync(); });
    await page.waitForFunction(() => window.__fixtureStreams.some(s => !s.closed && s.url.includes('BTCUSDT')));
    await page.waitForFunction(() => bnCurrentInterval === '5m' && bnKlineData.length === 35 && bnKlineData.at(-1).close === 101);
    const push = await page.evaluate(start => {
      const stream = window.__fixtureStreams.findLast(s => !s.closed);
      const emit = bar => stream.dispatchEvent(new MessageEvent('kline', { data: JSON.stringify({ instrument: 'crypto:binance:BTCUSDT', timeframe: '5m', bar, eventTime: Date.now() }) }));
      const initial = bnKlineData.length; emit({ time: start, open: 100, high: 106, low: 95, close: 103, volume: 6, closed: false });
      const updated = bnKlineData.at(-1).close; emit({ time: start + 300000, open: 103, high: 106, low: 102, close: 104, volume: 2, closed: false });
      return { initial, updated, final: bnKlineData.length, status: document.getElementById('mm-live-status-crypto').textContent };
    }, start);
    assert.equal(push.updated, 103); assert.equal(push.final, push.initial + 1); assert.match(push.status, /蜡烛形成中/);
    await page.route('**/api/binance/klines?**', async route => { await new Promise(r => setTimeout(r, 150)); await route.fulfill({ json: { success: true, data: rows } }); });
    const preserved = await page.evaluate(async start => {
      const pending = loadBinanceKlines({ live: true });
      const s = window.__fixtureStreams.findLast(s => !s.closed);
      s.dispatchEvent(new MessageEvent('kline', { data: JSON.stringify({ instrument: 'crypto:binance:BTCUSDT', timeframe: '5m', bar: { time: start + 300000, open: 103, high: 110, low: 102, close: 108, volume: 3, closed: false }, eventTime: Date.now() }) }));
      await pending; return bnKlineData.at(-1).close;
    }, start);
    assert.equal(preserved, 108, 'a delayed REST response must not overwrite newer stream data');
    await page.locator('#crypto-chart-card').locator('button', { hasText: '暂停自动更新' }).click();
    assert.equal(await page.evaluate(() => window.__fixtureStreams.every(s => s.closed)), true);
    await page.locator('#crypto-chart-card').locator('button', { hasText: '开启自动更新' }).click();
    await page.evaluate(() => { const s = window.__fixtureStreams.findLast(s => !s.closed); s.onerror(); });
    assert.match(await page.locator('#mm-live-status-crypto').innerText(), /REST 降级/);
    const themes = [];
    for (const theme of ['light', 'dark', 'money']) {
      themes.push(await page.evaluate(async theme => { if (theme === 'light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme); await new Promise(r => setTimeout(r, 200)); const style = getComputedStyle(document.getElementById('mm-live-status-crypto').previousElementSibling); return { theme, color: style.color, background: style.backgroundColor, radius: style.borderRadius }; }, theme));
    }
    assert.equal(new Set(themes.map(t => t.background)).size, 3); assert.ok(themes.every(t => parseFloat(t.radius) >= 6));
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.evaluate(() => { setMarketScope('options'); MoneyLiveKline.sync(); }); assert.equal(await page.evaluate(() => window.__fixtureStreams.every(s => s.closed)), true);
    const guest = await browser.newPage(); await guest.goto(base + '/login'); await Promise.all([guest.waitForURL(url => url.pathname === '/'), guest.click('#guestBtn')]);
    assert.equal(await guest.evaluate(() => fetch('/api/kline-stream?market=crypto&instrument=BTCUSDT&interval=5m').then(r => r.status)), 403);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, transportFixtureOnly: true, focus, push, themes, dataDirectory: data }));
  } finally { await browser?.close(); child.kill(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
