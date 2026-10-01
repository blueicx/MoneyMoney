const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const port = 3194, base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-action-smoke-'));
const user = 'action-owner', pass = 'isolated-action-smoke-92!';
const child = spawn(process.execPath,[path.join(__dirname,'../dist/web/server.js')],{ cwd:path.join(__dirname,'..'),stdio:'ignore',env:{ ...process.env,MONEYMONEY_DATA_DIR:dataDir,APP_HOST:'127.0.0.1',APP_PORT:String(port),MONEYMONEY_LOGIN_USER:user,MONEYMONEY_LOGIN_PASS:pass,MONEYMONEY_JWT_SECRET:'isolated-action-test-secret-0123456789abcdef',TELEGRAM_POLLING_ENABLED:'false',AI_PAPER_TRADING_ENABLED:'false',MONEYMONEY_DISABLE_GURU_REFRESH:'true',PRIVATE_KEY:'',API_KEY:'' } });
async function main() {
  let browser;
  try {
    let ready = false;
    for (let i=0;i<70;i++) { try { if ((await fetch(base+'/api/health/live')).ok) { ready=true;break; } } catch {} await new Promise(resolve=>setTimeout(resolve,200)); }
    assert.ok(ready,'isolated server starts');
    browser = await chromium.launch({ headless:true,channel:process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const context = await browser.newContext({ viewport:{ width:1440,height:900 },serviceWorkers:'block' });
    const page = await context.newPage(), errors = []; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/login'); await page.fill('#username',user); await page.fill('#password',pass);
    await Promise.all([page.waitForURL(url=>url.pathname==='/'),page.click('#submitBtn')]);
    const auth = (await (await context.request.get(base+'/api/auth/status')).json()).data;
    const headers = { 'x-csrf-token':auth.csrfToken };
    const diagnostics = await (await context.request.get(base+'/api/diagnostics')).json();
    assert.equal(diagnostics.data.marketHistoryCapture.enabled,true);
    assert.equal(diagnostics.data.marketHistoryCapture.intervalMinutes,30);
    assert.equal(diagnostics.data.marketHistoryCapture.maxInstrumentsPerRun,3);
    async function post(url,data) { const response = await context.request.post(base+url,{ data,headers }); const body=await response.json(); assert.ok(response.ok(),JSON.stringify(body));return body; }
    await post('/api/watchlist',{ instrumentId:'crypto:binance:BTCUSDT' });
    const now = new Date().toISOString();
    const evidence = await post('/api/evidence',{ market:'crypto',instrument:'crypto:binance:BTCUSDT',workspace:'event-intelligence',source:{ id:'exchange-test',name:'Isolated observed event',url:'https://www.binance.com' },dataStatus:'historical',observedAt:now,fetchedAt:now,fields:{ title:'BTC observed event',kind:'news',publishedAt:now,sourceUrl:'https://www.binance.com' } });
    const actions = await (await context.request.get(base+'/api/watchlist/action-center?market=crypto')).json();
    assert.ok(actions.items.some(row=>row.title==='BTC observed event'));
    const event = actions.items.find(row=>row.title==='BTC observed event');
    assert.ok(event.evidenceRefs.length); assert.equal(event.market,'crypto');
    for (const at of ['2020-01-01T00:00:00.000Z',now]) await post('/api/evidence',{ market:'crypto',instrument:'crypto:binance:BTCUSDT',workspace:'market-history',source:{ id:'binance',name:'Isolated historical snapshot' },dataStatus:'cached',observedAt:at,fetchedAt:at,fields:{ price:100 } });
    const cooled = await post('/api/market-history/capture',{ market:'crypto',instrument:'crypto:binance:BTCUSDT' });
    assert.equal(cooled.data.fetchedAt,now,'cooldown uses newest snapshot, never the oldest');
    assert.match(cooled.reason,/冷却/);
    await page.evaluate(()=>setMarketScope('watchlist'));
    await page.locator('#mm-action-center').waitFor({ state:'visible' });
    assert.equal(await page.locator('[data-mm-watchlist-sort] option[value="pending"]').count(),1);
    assert.equal(await page.locator('[data-mm-watchlist-sort] option[value="upcoming"]').count(),1);
    assert.equal(await page.locator('[data-mm-watchlist-sort] option[value="status"]').count(),1);
    await page.selectOption('#mm-action-market','crypto'); await page.click('#mm-action-refresh');
    const row = page.locator('#mm-action-list article').filter({ hasText:'BTC observed event' });
    await row.waitFor({ state:'visible',timeout:15000 });
    await row.locator('[data-pin]').click(); await row.locator('[data-pin]').filter({ hasText:'取消置顶' }).waitFor();
    await row.locator('[data-read]').click(); await row.locator('[data-read]').filter({ hasText:'标未读' }).waitFor();
    await row.locator('[data-detail]').click(); await page.locator('dialog.mm-action-detail').waitFor();
    assert.match(await page.locator('dialog').innerText(),/Isolated observed event/);
    await page.keyboard.press('Escape'); await page.click('#mm-action-refresh');
    await row.locator('[data-read]').filter({ hasText:'标未读' }).waitFor();
    await row.locator('[data-snooze]').click(); await row.waitFor({ state:'hidden' });
    await page.check('#mm-action-snoozed'); await row.waitFor({ state:'visible' });
    await row.locator('[data-snooze]').click();
    const experiments=[];
    for (const feeRate of [.001,.002]) {
      const result = await post('/api/research/experiments',{ market:'stocks',workspace:'backtest',instrument:'stock:us:AAPL',timeframe:'1d',dataStatus:'historical',dataSource:'isolated deterministic fixture',dataFrom:'2026-01-01',dataTo:'2026-02-01',strategyId:'momentum',strategyVersion:'v1',feeRate,slippage:.001,seed:10,prices:[100,101,99,102,104,103,106,108],signals:[],split:{ trainSize:4,testSize:2 } });
      experiments.push(result.data?.experiment?.id || result.experiment?.id);
    }
    await page.locator('details').filter({ has:page.locator('#mm-experiment-load') }).locator('summary').click();
    await page.click('#mm-experiment-load'); await page.locator('#mm-experiment-options input').first().waitFor();
    for (const input of await page.locator('#mm-experiment-options input').all()) await input.check();
    await page.click('#mm-experiment-compare'); await page.locator('#mm-experiment-result [data-curves] svg').waitFor();
    await page.locator('#mm-experiment-result [data-drawdowns] svg').waitFor();
    assert.match(await page.locator('#mm-experiment-result').innerText(),/不可直接.*排名/);
    await page.setViewportSize({ width:390,height:844 });
    assert.ok(await page.locator('#mm-action-refresh').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'mobile shell fits viewport');
    const noCsrf = await context.request.patch(base+'/api/watchlist/action-center/'+encodeURIComponent(event.id),{ data:{ read:false } }); assert.equal(noCsrf.status(),403);
    const guestContext=await browser.newContext(); await guestContext.request.post(base+'/api/auth/guest');
    for (const url of ['/api/watchlist/action-center','/api/research/experiments?market=stocks','/api/research/experiments/compare?ids='+experiments.join(','),'/api/signals/quality?market=stocks','/api/market-history?market=crypto&instrument=crypto:binance:BTCUSDT','/api/diagnostics']) assert.equal((await guestContext.request.get(base+url)).status(),403,url);
    await guestContext.close(); assert.deepEqual(errors,[]);
    console.log('Action/research Chromium smoke passed: real API aggregation, read/pin/snooze persistence, evidence drawer, experiment comparison, mobile, CSRF and guest isolation');
  } finally {
    if (browser) await browser.close(); child.kill('SIGINT');
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
    if (child.exitCode==null) child.kill('SIGKILL');
    const resolved=path.resolve(dataDir); if (resolved.startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(resolved).startsWith('moneymoney-action-smoke-')) fs.rmSync(resolved,{ recursive:true,force:true });
  }
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
