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
    const rows = Array.from({ length: 80 }, (_, i) => ({ time: start - (79 - i) * 300000, open: 100, high: 101, low: 99, close: 100, volume: 5 }));
    rows[30].high = 110;
    rows[50].low = 90;
    let requests = 0, supportRequests = 0;const stockKlineQueries=[];
    const olderRows=Array.from({length:20},(_,i)=>({...rows[0],time:rows[0].time-(20-i)*300000}));let historyRequests=0;
    await page.route('**/api/stock/kline?**', route => { requests++;const query=new URL(route.request().url()).searchParams;stockKlineQueries.push(query.toString());const paged=query.has('before');if(paged)historyRequests++; return route.fulfill({ json: { success: true,market:'stocks',instrument:query.get('api')||query.get('symbol'),timeframe:query.get('period'), data:paged?olderRows:rows, source: 'Isolated chart fixture, not market data', updatedAt: new Date().toISOString(), dataStatus: 'delayed' } }); });
    await page.route('**/api/stock/indices', async route => {
      await new Promise(resolve => setTimeout(resolve, 700));
      return route.fulfill({ json: { success: true, data: [{ name: 'Isolated index fixture', price: 100, changePct: 0.1 }] } });
    });
    await page.route('**/api/binance/klines?**', route => {const query=new URL(route.request().url()).searchParams,paged=query.has('before');if(paged)historyRequests++;return route.fulfill({ json: { success: true,market:'crypto',instrument:'crypto:binance:'+query.get('symbol'),timeframe:query.get('interval'), data:paged?olderRows:rows, source: 'Isolated chart fixture', updatedAt: new Date().toISOString(), dataStatus: 'delayed' } });});
    await page.route('**/api/support-resistance?**', route => { supportRequests++; return route.fulfill({ status: 410, json: { success: false, reason: 'chart Pivot must not use a second data source' } }); });
    await page.goto(base + '/login'); await page.fill('#username', 'live-fixture-owner'); await page.fill('#password', 'isolated-live-fixture-password');
    await Promise.all([page.waitForURL(url => url.pathname === '/'), page.click('#submitBtn')]);
    await page.waitForFunction(() => window.mm_isLoggedIn);
    await page.waitForFunction(() => window.mm_dashboardCoreReady === true && typeof window.setMarketScope === 'function', null, { timeout: 15_000 });
    assert.equal(await page.evaluate(() => !!window.MoneyLiveKline), false, 'the live chart transport should remain unloaded before entering a chart workspace');
    const delayedIndexResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/stock/indices');
    await page.evaluate(async () => { setMarketScope('stocks'); setWorkspaceInstrument('stock:us:AAPL'); openWorkspace('stock-quotes'); await loadStockKline('usAAPL', 'Apple', ''); });
    // The quote workspace no longer guarantees an index panel/request. Explicitly
    // exercise legacy late-card completion in an isolated hidden host instead of
    // relying on unrelated overview initialization timing.
    await page.evaluate(()=>{if(!document.getElementById('stock-indices')){const host=document.createElement('div');host.id='stock-indices';host.hidden=true;host.dataset.smokeFixture='late-index';document.body.append(host);}void loadStockQuotes({refreshChart:false});});
    await delayedIndexResponse;
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(requests, 1, 'late index-card completion must not reload an already-open instrument K-line');
    assert.equal(new URLSearchParams(stockKlineQueries[0]).get('chartWindow'),'1','ordinary stock chart bootstrap must opt into the bounded response');
    await page.locator('#stock-chart-card').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.MoneyLiveKline && window.MoneyTradingChart);
    await page.waitForFunction(() => stockChartKlines.length > 10 && document.getElementById('stock-chart-card').getAttribute('aria-busy') !== 'true').catch(async error => {
      console.error(JSON.stringify(await page.evaluate(() => ({ scope: document.body.dataset.marketScope, workspace: document.getElementById('market-workspace-shell')?.dataset.workspace, selected: window._stockSelectedSymbol, current: currentStockSymbol, chartState: document.getElementById('stock-chart-card')?.dataset.klineState, busy: document.getElementById('stock-chart-card')?.getAttribute('aria-busy'), status: document.querySelector('#stock-chart-card .mm-trading-status')?.textContent, reason: currentStockKlineReason, rows: stockChartKlines?.length, chartRuntime: !!window.MoneyTradingChart, chartAnalysis: !!window.MoneyChartAnalysis, loadedGroups: [...document.querySelectorAll('script[data-workspace-group]')].map(script => script.dataset.workspaceGroup) }))));
      throw error;
    });
    assert.equal(await page.evaluate(()=>currentStockKlinePeriod),'5m');
    assert.match(await page.locator('#stock-chart-card .mm-trading-readout').innerText(),/开 .*高 .*低 .*收 .*MA5/);
    for(const width of [1440,390])for(const theme of ['light','dark','money']){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>theme==='light'?document.documentElement.removeAttribute('data-theme'):document.documentElement.setAttribute('data-theme',theme),theme);
      const menu=page.locator('[data-compact-tools]'), summary=menu.locator(':scope > summary');
      await summary.focus();await page.keyboard.press('Enter');
      assert.equal(await menu.getAttribute('open'),'');
      const menuBounds=await menu.locator('.compact-nav-panel').boundingBox();
      assert.ok(menuBounds.x>=0&&menuBounds.x+menuBounds.width<=width+1,`compact menu must fit the viewport (${width}): ${JSON.stringify(menuBounds)}`);
      await menu.locator('button').first().focus();await page.keyboard.press('Escape');
      assert.equal(await menu.getAttribute('open'),null);
      assert.equal(await summary.evaluate(node=>node===document.activeElement),true);
      for(const id of ['stock-chart-history-tools','stock-chart-layer-tools']){
        const details=page.locator('#'+id);assert.equal(await details.getAttribute('open'),null);
        await details.locator(':scope > summary').focus();await page.keyboard.press('Space');
        assert.equal(await details.getAttribute('open'),'');
        await details.locator(':scope > summary').click();assert.equal(await details.getAttribute('open'),null);
      }
      assert.equal(await page.locator('.stock-kline-period.active').isVisible(),true);
      assert.equal(await page.locator('#stock-chart-data-status').isVisible(),true);
      const tool=page.locator('#stock-chart-card [data-chart-measure]'),layer=page.locator('#stock-chart-card .mm-trading-crosshair');await tool.click();await layer.scrollIntoViewIfNeeded();
      const rect=await layer.boundingBox();assert.ok(rect&&rect.width>100);
      await page.mouse.click(rect.x+rect.width*.25,rect.y+Math.min(rect.height*.3,120));await page.mouse.click(rect.x+rect.width*.65,rect.y+Math.min(rect.height*.3,120));
      assert.match(await page.locator('#stock-chart-card [data-chart-measurement]').innerText(),/测量.*收盘涨跌.*最大回撤.*自然时间/);
      assert.equal(await tool.getAttribute('aria-pressed'),'true');await page.screenshot({path:path.join(data,`measurement-${theme}-${width}.png`)});await tool.click();
      const beforeRules=await page.evaluate(()=>fetch('/api/alert-rules').then(r=>r.json()).then(body=>body.data.length));
      await page.locator('#stock-chart-card [data-chart-price-alert]').click();
      await layer.scrollIntoViewIfNeeded();const priceRect=await layer.boundingBox();
      await page.mouse.click(priceRect.x+priceRect.width*.45,priceRect.y+Math.min(priceRect.height*.3,120));
      const form=page.locator('#stock-chart-card [data-chart-alert-form]');await form.waitFor({state:'visible'});
      await form.locator('[data-chart-alert-price]').fill('103.5');await form.locator('[data-chart-alert-direction]').selectOption('below');
      await form.locator('[data-chart-alert-preview]').click();assert.match(await form.innerText(),/stock:us:AAPL.*达到或低于 103.5/);
      assert.equal(await page.evaluate(()=>fetch('/api/alert-rules').then(r=>r.json()).then(body=>body.data.length)),beforeRules,'preview must not write a rule');
      await form.locator('[data-chart-alert-confirm]').click();await form.locator('[data-chart-alert-message]').filter({hasText:'已保存提醒'}).waitFor();
      const saved=await page.evaluate(()=>fetch('/api/alert-rules').then(r=>r.json()).then(body=>body.data));assert.equal(saved.length,beforeRules+1);assert.equal(saved.at(-1).instrumentId,'stock:us:AAPL');assert.equal(saved.at(-1).condition.value,103.5);assert.equal(saved.at(-1).channels.telegram,false);
      await form.locator('[data-chart-alert-cancel]').click();
    }
    await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
    const zoomedStrategy = await page.evaluate(() => {
      const canvas = document.getElementById('stock-kline');
      const identity = currentStockSymbol + '|' + currentStockKlinePeriod;
      const previousView = MoneyTradingChart.select(canvas, stockChartKlines, identity).state;
      const savedView = { count: previousView.count, follow: previousView.follow, anchor: previousView.anchor };
      const previous = { rows: stockChartKlines, replayIndex: stockChartReplayIndex, focusEnabled: stockChartFocusEnabled, focusIndex: stockChartFocusIndex, config: stockChartOverlayConfig };
      const expandedRows = Array.from({ length: 30 }, (_, index) => ({
        time: Date.now() - (29 - index) * 300000,
        open: 100,
        high: index === 25 ? 102 : 101,
        low: 99,
        close: index === 25 ? 101 : 100,
        volume: index === 25 ? 200 : 100,
      }));
      stockChartKlines = expandedRows;
      stockChartReplayIndex = expandedRows.length - 1;
      stockChartFocusEnabled = false;
      stockChartFocusIndex = null;
      stockChartAsOf = '';
      stockChartIntradayDate = '';
      stockChartOverlayConfig = { ...previous.config, signals: true, patterns: false, structures: false, strategies: { maCross: false, rsiReversal: false, bollinger: false, volumeBreakout: true } };
      previousView.count = 15;
      previousView.follow = true;
      previousView.anchor = null;
      drawStockKline(canvas, expandedRows);
      const visibleRows = MoneyTradingChart.select(canvas, expandedRows, identity).rows.length;
      const signalText = document.getElementById('stock-chart-signals').textContent;
      const pointTargets = [...document.querySelectorAll('#stock-chart-signal-markers .chart-signal-hit-target')];
      pointTargets[0]?.click();
      const clickedMarker = {
        targetCount: pointTargets.length,
        replayIndex: stockChartReplayIndex,
        evidence: document.getElementById('stock-chart-evidence-detail')?.innerText || '',
      };
      document.querySelector('#stock-chart-signals .chart-signal-item')?.click();
      const clickedSignal = {
        replayIndex: stockChartReplayIndex,
        evidence: document.getElementById('stock-chart-evidence-detail')?.innerText || '',
      };
      stockChartKlines = previous.rows;
      stockChartReplayIndex = previous.replayIndex;
      stockChartFocusEnabled = previous.focusEnabled;
      stockChartFocusIndex = previous.focusIndex;
      stockChartOverlayConfig = previous.config;
      Object.assign(previousView, savedView);
      drawStockKline(canvas, stockChartKlines);
      return { visibleRows, signalText, clickedSignal, clickedMarker };
    });
    assert.equal(zoomedStrategy.visibleRows,15,'zoom fixture should display fewer than the 20-bar volume warmup period');
    assert.match(zoomedStrategy.signalText,/放量突破买入/,'volume-breakout signal should be calculated from full history and retained in the zoomed viewport');
    assert.equal(zoomedStrategy.clickedSignal.replayIndex,25,'clicking a zoomed signal must navigate to its full-history candle');
    assert.equal(zoomedStrategy.clickedMarker.targetCount,1,'the plotted stock strategy point should have an accessible direct hit target');
    assert.equal(zoomedStrategy.clickedMarker.replayIndex,25,'clicking the actual chart point must navigate to its exact full-history candle');
    assert.match(zoomedStrategy.clickedMarker.evidence,/触发价格：101/,'chart marker selection must open the same trigger evidence as the explanation list');
    assert.match(zoomedStrategy.clickedSignal.evidence,/触发价格：101/,'clicking a strategy point must retain its trigger price explanation');
    assert.match(zoomedStrategy.clickedSignal.evidence,/OHLC：100\.00 \/ 102\.00 \/ 99\.00 \/ 101\.00/,'clicking a strategy point must show the triggering candle values');
    const patternMarkerBounds=await page.evaluate(()=>{
      const canvas=document.getElementById('stock-kline'),layer=document.getElementById('stock-chart-patterns');
      const priceBottom=28+(canvas.clientHeight-28-30)*.72;
      const bounds={left:60,right:canvas.clientWidth-88,top:30,bottom:priceBottom-2};
      renderChartPatternMarkers('stock-chart-patterns',[
        {label:'上沿测试',index:0,time:stockChartKlines[0].time,direction:'bearish'},
        {label:'下沿测试',index:1,time:stockChartKlines[1].time,direction:'bullish'},
      ],item=>({x:item.index===0?-500:canvas.clientWidth+500,y:item.index===0?-500:canvas.clientHeight+500,minX:bounds.left,maxX:bounds.right,minY:bounds.top,maxY:bounds.bottom}));
      const canvasRect=canvas.getBoundingClientRect();
      return [...layer.querySelectorAll('.chart-pattern-marker')].map(marker=>{
        const rect=marker.getBoundingClientRect();
        return {left:rect.left-canvasRect.left,right:rect.right-canvasRect.left,top:rect.top-canvasRect.top,bottom:rect.bottom-canvasRect.top,bounds};
      });
    });
    assert.equal(patternMarkerBounds.length,2,'edge fixture markers should remain available');
    for(const marker of patternMarkerBounds){
      assert.ok(marker.left>=marker.bounds.left-0.5&&marker.right<=marker.bounds.right+0.5,`pattern icon escaped horizontal plot bounds: ${JSON.stringify(marker)}`);
      assert.ok(marker.top>=marker.bounds.top-0.5&&marker.bottom<=marker.bounds.bottom+0.5,`pattern icon escaped vertical price bounds: ${JSON.stringify(marker)}`);
    }
    await page.evaluate(()=>drawStockKline(document.getElementById('stock-kline'),stockChartKlines));
    await page.evaluate(() => {
      window.__supportResistanceDraws = [];
      const draw = window.MoneyTradingChart.drawSupportResistance;
      window.MoneyTradingChart.drawSupportResistance = (ctx, lines, geometry) => {
        window.__supportResistanceDraws.push({ canvas: ctx.canvas?.id, prices: lines.map(line => line.price), types: lines.map(line => line.type) });
        return draw(ctx, lines, geometry);
      };
      setStockChartOverlay('supportResistance', true);
    });
    await page.evaluate(() => drawStockKline(document.getElementById('stock-kline'), stockChartKlines));
    const stockSupportOverlay = await page.evaluate(() => window.__supportResistanceDraws.findLast(draw => draw.canvas === 'stock-kline'));
    assert.deepEqual(stockSupportOverlay?.prices, [90, 110], 'stock chart must project confirmed pivots from its selected K-line dataset');
    assert.deepEqual(stockSupportOverlay?.types, ['support', 'resistance']);
    await page.locator('#stock-chart-layer-tools > summary').click();
    assert.match(await page.locator('#stock-sr-status').innerText(), /已确认 Pivot 2 条（支撑 90 \/ 阻力 110）.*不使用未来K线/);
    assert.match(await page.locator('#stock-sr-status').innerText(), /来源时间/);
    const replayPivot = await page.evaluate(() => {
      stockChartReplayIndex = 33; drawStockKline(document.getElementById('stock-kline'), stockChartKlines);
      const beforeConfirmation = window.__supportResistanceDraws.findLast(draw => draw.canvas === 'stock-kline')?.prices || [];
      stockChartReplayIndex = 34; drawStockKline(document.getElementById('stock-kline'), stockChartKlines);
      const afterConfirmation = window.__supportResistanceDraws.findLast(draw => draw.canvas === 'stock-kline')?.prices || [];
      stockChartReplayIndex = stockChartKlines.length - 1; drawStockKline(document.getElementById('stock-kline'), stockChartKlines);
      return { beforeConfirmation, afterConfirmation };
    });
    assert.equal(replayPivot.beforeConfirmation.includes(110), false, 'Replay must not reveal a pivot before the extra closed bar confirms it');
    assert.equal(replayPivot.afterConfirmation.includes(110), true, 'Replay must reveal the pivot when its confirmation bar is reached');
    let paperRequests=0;
    await page.route('**/api/paper/chart-markers?**',route=>{paperRequests++;return route.fulfill({json:{success:true,market:'stocks',instrument:'stock:us:AAPL',dataStatus:'historical',source:'isolated ledger fixture',data:{markers:[{market:'stocks',instrument:'stock:us:AAPL',orderId:'fixture-order',signalId:'fixture-signal',snapshotId:'fixture-snapshot',accountId:'fixture-account',time:rows[60].time+1000,price:101,quantity:1,side:'BUY',feeUsd:.1,slippageUsd:.2}],unlinked:[{orderId:'legacy-order',reason:'未关联：缺少信号 ID'}]}}});});
    assert.equal(paperRequests,0,'unselected paper layer must not request ledger');
    await page.locator('#stock-chart-card [data-paper-chart-layer]').check();
    const paperSummary=page.locator('#stock-chart-card summary').filter({hasText:'模拟成交与关联证据'});
    const paperDetails=paperSummary.locator('..');
    await paperDetails.filter({hasText:'fixture-order'}).waitFor({state:'attached'});
    await paperSummary.click();assert.equal(paperRequests,1);assert.match(await paperDetails.innerText(),/fixture-snapshot.*费用 0.1/);assert.match(await paperDetails.innerText(),/未关联/);
    await page.locator('#stock-chart-card [data-paper-chart-layer]').uncheck();
    const focus = await page.evaluate(async () => { stockChartFocusIndex = 10; stockChartFocusEnabled = true; const time = stockChartKlines[10].time; window.__unifiedCalls = 0; const original = loadUnifiedStockData; loadUnifiedStockData = (...args) => { window.__unifiedCalls++; return original(...args); }; await loadStockKline(undefined, undefined, undefined, { live: true }); return { expected: time, actual: stockChartKlines[stockChartFocusIndex].time, focus: stockChartFocusEnabled, extraCalls: window.__unifiedCalls }; });
    assert.equal(focus.actual, focus.expected); assert.equal(focus.focus, true); assert.equal(focus.extraCalls, 0);
    assert.equal(historyRequests,0,'history is not a bootstrap request');assert.equal(await page.locator('#stock-chart-card [data-chart-history]').isVisible(),false,'focused historical view must not offer ordinary source paging');
    await page.evaluate(()=>{stockChartFocusEnabled=false;stockChartFocusIndex=null;drawStockKline(document.getElementById('stock-kline'),stockChartKlines);});
    await page.locator('#stock-chart-card [data-chart-history]').click();await page.waitForFunction(()=>stockChartKlines.length===100);
    assert.equal(new URLSearchParams(stockKlineQueries.at(-1)).has('chartWindow'),false,'earlier-page request must use the existing bounded cursor contract');
    await page.evaluate(()=>loadStockKline(undefined,undefined,undefined,{live:true}));assert.equal(await page.evaluate(()=>stockChartKlines[0].time),olderRows[0].time,'live refresh must retain requested history');assert.equal(historyRequests,1);
    const before = requests;
    await page.evaluate(async () => { stepStockChartReplay('previous'); await loadStockKline(undefined, undefined, undefined, { live: true }); });
    assert.equal(requests, before, 'Replay must block live reads');
    assert.equal(await page.locator('#stock-kline').getAttribute('data-trading-mode'),'historical','Replay must not display a live candle countdown');
    await page.evaluate(async () => { stepStockChartReplay('next'); stockChartAsOf = '2026-01-01'; MoneyLiveKline.sync(); await loadStockKline(undefined, undefined, undefined, { live: true }); });
    assert.equal(requests, before, 'asOf must block live reads');
    await page.route('**/api/alerts**', route => new URL(route.request().url()).pathname === '/api/alerts' ? route.fulfill({ json: [] }) : route.fallback());
    await page.evaluate(() => {
      const original = window.loadAlertsForChart;
      window.__chartAlertLoads = 0;
      window.loadAlertsForChart = async (...args) => {
        window.__chartAlertLoads += 1;
        try { return await original(...args); } finally { window.__chartAlertLoads -= 1; }
      };
    });
    await page.evaluate(async () => { stockChartAsOf = ''; setMarketScope('crypto'); openWorkspace('crypto-quotes'); bnCurrentSymbol = 'BTCUSDT'; bnCurrentInterval = '5m'; await loadBinanceKlines(); MoneyLiveKline.sync(); });
    await page.waitForFunction(() => window.__fixtureStreams.some(s => !s.closed && s.url.includes('BTCUSDT')));
    await page.waitForFunction(() => bnCurrentInterval === '5m' && bnKlineData.length === 80 && bnKlineData.at(-1).close === 100);
    await page.waitForFunction(() => window.__chartAlertLoads === 0 && bnKlineData.length === 80);
    await page.evaluate(() => setCryptoChartOverlay('supportResistance', true));
    await page.evaluate(() => drawCandles(document.getElementById('bn-candlestick'), bnKlineData));
    const cryptoSupportOverlay = await page.evaluate(() => window.__supportResistanceDraws.findLast(draw => draw.canvas === 'bn-candlestick'));
    assert.deepEqual(cryptoSupportOverlay?.prices, [90, 110], 'crypto chart must project confirmed pivots from its selected K-line dataset');
    assert.deepEqual(cryptoSupportOverlay?.types, ['support', 'resistance']);
    assert.match(await page.locator('#crypto-sr-status').innerText(), /已确认 Pivot 2 条（支撑 90 \/ 阻力 110）.*不使用未来K线/);
    assert.match(await page.locator('#crypto-sr-status').innerText(), /数据状态 delayed.*来源时间/);
    assert.equal(supportRequests, 0, 'stock and crypto chart overlays must not fetch a second support/resistance dataset');
    await page.evaluate(() => setCryptoChartOverlay('supportResistance', false));
    const push = await page.evaluate(start => {
      const stream = window.__fixtureStreams.findLast(s => !s.closed);
      const emit = bar => stream.dispatchEvent(new MessageEvent('kline', { data: JSON.stringify({ instrument: 'crypto:binance:BTCUSDT', timeframe: '5m', bar, eventTime: Date.now() }) }));
      const initial = bnKlineData.length; emit({ time: start, open: 100, high: 106, low: 95, close: 103, volume: 6, closed: false });
      const updated = bnKlineData.at(-1).close; emit({ time: start + 300000, open: 103, high: 106, low: 102, close: 104, volume: 2, closed: false });
      return { initial, updated, final: bnKlineData.length, status: document.getElementById('mm-live-status-crypto').textContent };
    }, start);
    assert.equal(push.updated, 103); assert.equal(push.final, push.initial + 1); assert.match(push.status, /蜡烛形成中/);
    const strategyLifecycle=await page.evaluate(start=>{
      const canvas=document.getElementById('bn-candlestick'),previous={rows:bnKlineData,metadata:canvas.moneySourceMetadata,config:{...cryptoChartStrategyConfig},timer:window.cryptoMoneyKLine};
      const strategyBars=Array.from({length:31},(_,index)=>{const close=index<29?100:index===29?90:130;return{time:start-(30-index)*300000,open:close,high:close+1,low:close-1,close,volume:100,closed:false};});
      cryptoChartStrategyConfig={maCross:true,rsiReversal:false,bollinger:false,volumeBreakout:false};localStorage.setItem(cryptoChartStorageKey(),JSON.stringify(cryptoChartStrategyConfig));
      bnKlineData=strategyBars;canvas.moneySourceMetadata={connection:'live',sourceTime:Date.now(),dataStatus:'live',source:'Isolated strategy fixture'};window.cryptoMoneyKLine={timer:null};drawCandles(canvas,bnKlineData);
      const forming={count:document.querySelectorAll('#bn-chart-signals [data-signal-status="forming"]').length,text:document.getElementById('bn-chart-signals').textContent,title:document.querySelector('#bn-chart-signals [data-signal-status="forming"]')?.title};
      bnKlineData[30]={...bnKlineData[30],open:85,high:86,low:84,close:85};drawCandles(canvas,bnKlineData);const removed=document.querySelectorAll('#bn-chart-signals [data-signal-status="forming"],#bn-chart-signals [data-signal-status="confirmed"]').length;
      bnKlineData[30]={...bnKlineData[30],open:100,high:131,low:99,close:130};canvas.moneySourceMetadata.sourceTime=Date.now()-120000;drawCandles(canvas,bnKlineData);const stale=document.querySelectorAll('#bn-chart-signals [data-signal-status="forming"],#bn-chart-signals [data-signal-status="confirmed"]').length;
      canvas.moneySourceMetadata.sourceTime=Date.now();bnKlineData[30]={...bnKlineData[30],closed:true};drawCandles(canvas,bnKlineData);const confirmed={count:document.querySelectorAll('#bn-chart-signals [data-signal-status="confirmed"]').length,text:document.getElementById('bn-chart-signals').textContent};
      bnKlineData=previous.rows;canvas.moneySourceMetadata=previous.metadata;cryptoChartStrategyConfig=previous.config;window.cryptoMoneyKLine=previous.timer;drawCandles(canvas,bnKlineData);
      return{forming,removed,stale,confirmed};
    },start);
    assert.equal(strategyLifecycle.forming.count,1,'live strategy point must be shown as forming');assert.match(strategyLifecycle.forming.text,/形成中/);assert.match(strategyLifecycle.forming.title,/来源：Isolated strategy fixture/);assert.match(strategyLifecycle.forming.title,/策略版本：chart-strategy-v1/);
    assert.equal(strategyLifecycle.removed,0,'a forming marker must be removed when its live condition no longer holds');assert.equal(strategyLifecycle.stale,0,'stale source data must not keep a forming strategy marker');
    assert.equal(strategyLifecycle.confirmed.count,1,'the still-valid signal becomes confirmed when the provider closes its candle');assert.match(strategyLifecycle.confirmed.text,/已确认/);
    const overlay=page.locator('#crypto-chart-card .mm-trading-crosshair');await overlay.scrollIntoViewIfNeeded();
    const bounds=await overlay.boundingBox();await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+80);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+80,{steps:5});await page.mouse.up();
    await page.locator('#crypto-chart-card .mm-trading-latest').waitFor({state:'visible'});
    const anchored=await page.evaluate(()=>MoneyTradingChart.select(document.getElementById('bn-candlestick'),bnKlineData,bnCurrentSymbol+'|'+bnCurrentInterval).rows.at(-1).time);
    await page.evaluate(start=>{const s=window.__fixtureStreams.findLast(s=>!s.closed);s.dispatchEvent(new MessageEvent('kline',{data:JSON.stringify({instrument:'crypto:binance:BTCUSDT',timeframe:'5m',bar:{time:start+600000,open:104,high:109,low:103,close:108,volume:3},eventTime:Date.now()})}));},start);
    assert.equal(await page.evaluate(()=>MoneyTradingChart.select(document.getElementById('bn-candlestick'),bnKlineData,bnCurrentSymbol+'|'+bnCurrentInterval).rows.at(-1).time),anchored);
    await page.locator('#crypto-chart-card .mm-trading-latest').click();
    assert.equal(await page.evaluate(()=>MoneyTradingChart.select(document.getElementById('bn-candlestick'),bnKlineData,bnCurrentSymbol+'|'+bnCurrentInterval).state.follow),true);
    await page.route('**/api/binance/klines?**', async route => {if(new URL(route.request().url()).searchParams.has('before'))return route.fallback(); await new Promise(r => setTimeout(r, 150)); await route.fulfill({ json: { success: true, data: rows } }); });
    const preserved = await page.evaluate(async start => {
      const pending = loadBinanceKlines({ live: true });
      const s = window.__fixtureStreams.findLast(s => !s.closed);
      s.dispatchEvent(new MessageEvent('kline', { data: JSON.stringify({ instrument: 'crypto:binance:BTCUSDT', timeframe: '5m', bar: { time: start + 600000, open: 103, high: 110, low: 102, close: 108, volume: 3, closed: false }, eventTime: Date.now() }) }));
      await pending; return { close: bnKlineData.at(-1).close, last: bnKlineData.at(-1), activeStreams: window.__fixtureStreams.filter(stream => !stream.closed).length, status: document.getElementById('mm-live-status-crypto')?.textContent };
    }, start);
    assert.equal(preserved.close, 108, `a delayed REST response must not overwrite newer stream data: ${JSON.stringify(preserved)}`);
    await page.locator('#crypto-chart-card').locator('button', { hasText: '暂停自动更新' }).click();
    await page.waitForFunction(() => document.getElementById('mm-live-status-crypto')?.textContent.includes('自动更新已关闭'));
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const performance = await page.evaluate(async () => {
      const host=document.querySelector('#crypto-chart-card .mm-trading-chart'),readout=host.querySelector('.mm-trading-readout');
      let mutations=0,paints=0,phase='timer';const timerPaintStacks=[];const observer=new MutationObserver(list=>mutations+=list.length);observer.observe(readout,{childList:true,subtree:true,characterData:true});
      const original=CanvasRenderingContext2D.prototype.stroke;CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.classList.contains('mm-trading-crosshair')){paints++;if(phase==='timer')timerPaintStacks.push(new Error().stack);}return original.apply(this,args);};
      await new Promise(resolve=>setTimeout(resolve,1200));const timerMutations=mutations,timerPaints=paints;phase='pointer';
      const layer=host.querySelector('.mm-trading-crosshair'),box=layer.getBoundingClientRect();
      for(let n=0;n<30;n++)layer.dispatchEvent(new PointerEvent('pointermove',{clientX:box.left+100+n,clientY:box.top+100,pointerId:1}));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const pointerPaints=paints-timerPaints;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});const before=paints;
      MoneyTradingChart.redraw(document.getElementById('bn-candlestick'));layer.dispatchEvent(new PointerEvent('pointermove',{clientX:box.left+140,clientY:box.top+120,pointerId:1}));
      await new Promise(resolve=>setTimeout(resolve,1200));const hiddenPaints=paints-before;
      delete document.hidden;observer.disconnect();CanvasRenderingContext2D.prototype.stroke=original;
      return {timerMutations,timerPaints,timerPaintStacks,pointerPaints,hiddenPaints};
    });
    if(performance.timerPaints)console.error('live-kline timer redraw diagnostic: '+JSON.stringify({timerPaints:performance.timerPaints,stacks:performance.timerPaintStacks}));
    assert.equal(performance.timerMutations,0,'countdown must not rebuild OHLC/MA DOM');assert.equal(performance.timerPaints,0,'countdown must not redraw canvas');assert.ok(performance.pointerPaints<=2,'pointer burst must coalesce into one frame');assert.equal(performance.hiddenPaints,0,'hidden document must not draw');
    await page.locator('#crypto-chart-card').locator('button', { hasText: '开启自动更新' }).click();
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
    await page.locator('#crypto-chart-card [data-chart-history]').click();await page.waitForFunction(()=>bnKlineData.length>=100,{},{timeout:5000}).catch(async error=>{console.error(await page.evaluate(()=>({rows:bnKlineData.length,first:bnKlineData[0]?.time,scope:document.getElementById('market-workspace-shell')?.dataset.marketScope,note:document.querySelector('#crypto-chart-card .mm-trading-status')?.textContent})));throw error;});assert.equal(historyRequests,2);
    await page.evaluate(()=>loadBinanceKlines({live:true}));assert.equal(await page.evaluate(()=>bnKlineData[0].time),olderRows[0].time,'crypto REST refresh must retain requested history');
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
    assert.equal(supportRequests, 0, 'chart overlays must remain derived from chart-scoped bars through workspace changes');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, transportFixtureOnly: true, supportRequests, replayPivot, focus, push, performance, themes, dataDirectory: data }));
  } finally { await browser?.close(); child.kill(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
