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
    const rows = Array.from({ length: 80 }, (_, i) => ({ time: start - (79 - i) * 300000, open: 100, high: 105, low: 95, close: 101, volume: 5 }));
    let requests = 0;
    await page.route('**/api/stock/kline?**', route => { requests++; return route.fulfill({ json: { success: true, data: rows, source: 'Isolated chart fixture, not market data', updatedAt: new Date().toISOString(), dataStatus: 'delayed' } }); });
    await page.route('**/api/binance/klines?**', route => route.fulfill({ json: { success: true, data: rows, source: 'Isolated chart fixture', updatedAt: new Date().toISOString(), dataStatus: 'delayed' } }));
    await page.goto(base + '/login'); await page.fill('#username', 'live-fixture-owner'); await page.fill('#password', 'isolated-live-fixture-password');
    await Promise.all([page.waitForURL(url => url.pathname === '/'), page.click('#submitBtn')]);
    await page.waitForFunction(() => window.mm_isLoggedIn && window.MoneyLiveKline);
    await page.evaluate(async () => { setMarketScope('stocks'); openWorkspace('stock-quotes'); await loadStockKline('usAAPL', 'Apple', ''); });
    await page.locator('#stock-chart-card').waitFor({ state: 'visible' });
    await page.waitForFunction(() => stockChartKlines.length > 10 && document.getElementById('stock-chart-card').getAttribute('aria-busy') !== 'true');
    assert.equal(await page.evaluate(()=>currentStockKlinePeriod),'5m');
    assert.match(await page.locator('#stock-chart-card .mm-trading-readout').innerText(),/开 .*高 .*低 .*收 .*MA5/);
    let paperRequests=0;
    await page.route('**/api/paper/chart-markers?**',route=>{paperRequests++;return route.fulfill({json:{success:true,market:'stocks',instrument:'stock:us:AAPL',dataStatus:'historical',source:'isolated ledger fixture',data:{markers:[{market:'stocks',instrument:'stock:us:AAPL',orderId:'fixture-order',signalId:'fixture-signal',snapshotId:'fixture-snapshot',accountId:'fixture-account',time:rows[60].time+1000,price:101,quantity:1,side:'BUY',feeUsd:.1,slippageUsd:.2}],unlinked:[{orderId:'legacy-order',reason:'未关联：缺少信号 ID'}]}}});});
    assert.equal(paperRequests,0,'unselected paper layer must not request ledger');
    await page.locator('#stock-chart-card [data-paper-chart-layer]').check();
    await page.waitForFunction(()=>document.querySelector('#stock-chart-card details')?.textContent.includes('fixture-order'));
    await page.locator('#stock-chart-card details summary').click();assert.equal(paperRequests,1);assert.match(await page.locator('#stock-chart-card details').innerText(),/fixture-snapshot.*费用 0.1/);assert.match(await page.locator('#stock-chart-card details').innerText(),/未关联/);
    await page.locator('#stock-chart-card [data-paper-chart-layer]').uncheck();
    const focus = await page.evaluate(async () => { stockChartFocusIndex = 10; stockChartFocusEnabled = true; const time = stockChartKlines[10].time; window.__unifiedCalls = 0; const original = loadUnifiedStockData; loadUnifiedStockData = (...args) => { window.__unifiedCalls++; return original(...args); }; await loadStockKline(undefined, undefined, undefined, { live: true }); return { expected: time, actual: stockChartKlines[stockChartFocusIndex].time, focus: stockChartFocusEnabled, extraCalls: window.__unifiedCalls }; });
    assert.equal(focus.actual, focus.expected); assert.equal(focus.focus, true); assert.equal(focus.extraCalls, 0);
    const before = requests;
    await page.evaluate(async () => { stepStockChartReplay('previous'); await loadStockKline(undefined, undefined, undefined, { live: true }); });
    assert.equal(requests, before, 'Replay must block live reads');
    assert.equal(await page.locator('#stock-kline').getAttribute('data-trading-mode'),'historical','Replay must not display a live candle countdown');
    await page.evaluate(async () => { stepStockChartReplay('next'); stockChartAsOf = '2026-01-01'; MoneyLiveKline.sync(); await loadStockKline(undefined, undefined, undefined, { live: true }); });
    assert.equal(requests, before, 'asOf must block live reads');
    await page.evaluate(async () => { stockChartAsOf = ''; setMarketScope('crypto'); openWorkspace('crypto-quotes'); bnCurrentSymbol = 'BTCUSDT'; bnCurrentInterval = '5m'; await loadBinanceKlines(); MoneyLiveKline.sync(); });
    await page.waitForFunction(() => window.__fixtureStreams.some(s => !s.closed && s.url.includes('BTCUSDT')));
    await page.waitForFunction(() => bnCurrentInterval === '5m' && bnKlineData.length === 80 && bnKlineData.at(-1).close === 101);
    const push = await page.evaluate(start => {
      const stream = window.__fixtureStreams.findLast(s => !s.closed);
      const emit = bar => stream.dispatchEvent(new MessageEvent('kline', { data: JSON.stringify({ instrument: 'crypto:binance:BTCUSDT', timeframe: '5m', bar, eventTime: Date.now() }) }));
      const initial = bnKlineData.length; emit({ time: start, open: 100, high: 106, low: 95, close: 103, volume: 6, closed: false });
      const updated = bnKlineData.at(-1).close; emit({ time: start + 300000, open: 103, high: 106, low: 102, close: 104, volume: 2, closed: false });
      return { initial, updated, final: bnKlineData.length, status: document.getElementById('mm-live-status-crypto').textContent };
    }, start);
    assert.equal(push.updated, 103); assert.equal(push.final, push.initial + 1); assert.match(push.status, /蜡烛形成中/);
    const overlay=page.locator('#crypto-chart-card .mm-trading-crosshair');await overlay.scrollIntoViewIfNeeded();
    const bounds=await overlay.boundingBox();await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+80);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+80,{steps:5});await page.mouse.up();
    await page.locator('#crypto-chart-card .mm-trading-latest').waitFor({state:'visible'});
    const anchored=await page.evaluate(()=>MoneyTradingChart.select(document.getElementById('bn-candlestick'),bnKlineData,bnCurrentSymbol+'|'+bnCurrentInterval).rows.at(-1).time);
    await page.evaluate(start=>{const s=window.__fixtureStreams.findLast(s=>!s.closed);s.dispatchEvent(new MessageEvent('kline',{data:JSON.stringify({instrument:'crypto:binance:BTCUSDT',timeframe:'5m',bar:{time:start+600000,open:104,high:109,low:103,close:108,volume:3},eventTime:Date.now()})}));},start);
    assert.equal(await page.evaluate(()=>MoneyTradingChart.select(document.getElementById('bn-candlestick'),bnKlineData,bnCurrentSymbol+'|'+bnCurrentInterval).rows.at(-1).time),anchored);
    await page.locator('#crypto-chart-card .mm-trading-latest').click();
    assert.equal(await page.evaluate(()=>MoneyTradingChart.select(document.getElementById('bn-candlestick'),bnKlineData,bnCurrentSymbol+'|'+bnCurrentInterval).state.follow),true);
    await page.route('**/api/binance/klines?**', async route => { await new Promise(r => setTimeout(r, 150)); await route.fulfill({ json: { success: true, data: rows } }); });
    const preserved = await page.evaluate(async start => {
      const pending = loadBinanceKlines({ live: true });
      const s = window.__fixtureStreams.findLast(s => !s.closed);
      s.dispatchEvent(new MessageEvent('kline', { data: JSON.stringify({ instrument: 'crypto:binance:BTCUSDT', timeframe: '5m', bar: { time: start + 600000, open: 103, high: 110, low: 102, close: 108, volume: 3, closed: false }, eventTime: Date.now() }) }));
      await pending; return bnKlineData.at(-1).close;
    }, start);
    assert.equal(preserved, 108, 'a delayed REST response must not overwrite newer stream data');
    const performance = await page.evaluate(async () => {
      const host=document.querySelector('#crypto-chart-card .mm-trading-chart'),readout=host.querySelector('.mm-trading-readout');
      let mutations=0,paints=0;const observer=new MutationObserver(list=>mutations+=list.length);observer.observe(readout,{childList:true,subtree:true,characterData:true});
      const original=CanvasRenderingContext2D.prototype.stroke;CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.classList.contains('mm-trading-crosshair'))paints++;return original.apply(this,args);};
      await new Promise(resolve=>setTimeout(resolve,1200));const timerMutations=mutations,timerPaints=paints;
      const layer=host.querySelector('.mm-trading-crosshair'),box=layer.getBoundingClientRect();
      for(let n=0;n<30;n++)layer.dispatchEvent(new PointerEvent('pointermove',{clientX:box.left+100+n,clientY:box.top+100,pointerId:1}));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const pointerPaints=paints-timerPaints;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});const before=paints;
      MoneyTradingChart.redraw(document.getElementById('bn-candlestick'));layer.dispatchEvent(new PointerEvent('pointermove',{clientX:box.left+140,clientY:box.top+120,pointerId:1}));
      await new Promise(resolve=>setTimeout(resolve,1200));const hiddenPaints=paints-before;
      delete document.hidden;observer.disconnect();CanvasRenderingContext2D.prototype.stroke=original;
      return {timerMutations,timerPaints,pointerPaints,hiddenPaints};
    });
    assert.equal(performance.timerMutations,0,'countdown must not rebuild OHLC/MA DOM');assert.equal(performance.timerPaints,0,'countdown must not redraw canvas');assert.ok(performance.pointerPaints<=2,'pointer burst must coalesce into one frame');assert.equal(performance.hiddenPaints,0,'hidden document must not draw');
    const gestures=await page.evaluate(async()=>{
      const canvas=document.getElementById('bn-candlestick'),layer=canvas.parentElement.querySelector('.mm-trading-crosshair'),box=layer.getBoundingClientRect(),key=bnCurrentSymbol+'|'+bnCurrentInterval;
      const event=(type,id,x,y)=>layer.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:box.left+x,clientY:box.top+y}));
      // Synthetic touch ids cannot be captured by Chromium: use the same DOM listener, bypass only capture.
      const capture=layer.setPointerCapture;layer.setPointerCapture=()=>{};
      const initial=MoneyTradingChart.select(canvas,bnKlineData,key).state.count;
      event('pointerdown',41,100,80);event('pointerdown',42,200,80);event('pointermove',42,280,80);event('pointerup',42,280,80);event('pointerup',41,100,80);
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const zoomed=MoneyTradingChart.select(canvas,bnKlineData,key).state.count;
      event('pointerdown',43,box.width-10,70);event('pointermove',43,box.width-10,120);event('pointerup',43,box.width-10,120);
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const scale=MoneyTradingChart.select(canvas,bnKlineData,key).state.priceScale;
      canvas.parentElement.querySelectorAll('.mm-trading-zone')[1].click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const restored=MoneyTradingChart.select(canvas,bnKlineData,key).state.priceScale;layer.setPointerCapture=capture;
      return {initial,zoomed,scale,restored:restored??null};
    });
    assert.ok(gestures.zoomed<gestures.initial);assert.ok(gestures.scale>1);assert.equal(gestures.restored,null);
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
    await page.route('**/api/contracts/detail?**',route=>route.fulfill({json:{success:true,market:'crypto',instrument:'crypto:gateio:BTC_USDT',contract:'BTC_USDT',kind:'perpetual',source:'Isolated Gate fixture',updatedAt:new Date().toISOString(),dataStatus:'delayed',sections:{bars:{reason:null,source:'https://www.gate.com',updatedAt:new Date().toISOString(),dataStatus:'delayed'},funding:{reason:'来源暂无记录',source:'https://www.gate.com',dataStatus:'empty'}},quote:{markPrice:101},depth:{bids:[],asks:[]},candles:[],funding:[]}}));
    await page.route('**/api/contracts/kline?**',route=>route.fulfill({json:{success:true,market:'crypto',instrument:'crypto:gateio:BTC_USDT',source:'Isolated Gate fixture',updatedAt:new Date().toISOString(),dataStatus:'delayed',data:rows,volumeUnit:'contracts'}}));
    await page.evaluate(()=>{setWorkspaceInstrument('crypto:gateio:BTC_USDT');openWorkspace('contracts');});
    await page.locator('[data-contract-canvas]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-contract-interval]').inputValue(),'5m');
    assert.match(await page.locator('#mm-contract-workspace .mm-trading-readout').innerText(),/成交量 .*张/);
    await page.locator('[data-contract-interval]').selectOption('1m');
    await page.waitForFunction(()=>document.querySelector('[data-contract-chart-status]')?.textContent.includes('REST'));
    await page.locator('[data-contract-fullscreen]').click();
    await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('mm-contract-chart') || document.querySelector('.mm-trading-fullscreen'));
    await page.screenshot({path:path.join(data,'trading-contract-chart.png')});
    await page.locator('[data-contract-fullscreen]').click();
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.evaluate(() => { setMarketScope('options'); MoneyLiveKline.sync(); }); assert.equal(await page.evaluate(() => window.__fixtureStreams.every(s => s.closed)), true);
    const guest = await browser.newPage(); await guest.goto(base + '/login'); await Promise.all([guest.waitForURL(url => url.pathname === '/'), guest.click('#guestBtn')]);
    assert.equal(await guest.evaluate(() => fetch('/api/kline-stream?market=crypto&instrument=BTCUSDT&interval=5m').then(r => r.status)), 403);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, transportFixtureOnly: true, focus, push, performance, themes, dataDirectory: data }));
  } finally { await browser?.close(); child.kill(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
