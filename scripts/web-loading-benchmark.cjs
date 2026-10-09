// Controlled Chromium comparison: API failures are fixed fixtures so upstream
// availability cannot masquerade as a frontend speed improvement.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const appRoot = path.resolve(process.env.MONEYMONEY_BENCHMARK_ROOT || path.join(__dirname, '..'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-load-benchmark-'));
const child = spawn(process.execPath, [path.join(appRoot, 'dist', 'web', 'server.js')], {
  cwd: appRoot, stdio: 'ignore',
  env: { ...process.env, MONEYMONEY_DATA_DIR: root, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_POLLING_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', AI_PAPER_TRADING_ENABLED: 'false', MONEYMONEY_DISABLE_GURU_REFRESH: 'true', PRIVATE_KEY: '', API_KEY: '', MONEYMONEY_LOGIN_USER: 'benchmark-owner', MONEYMONEY_LOGIN_PASS: 'benchmark-only-92!', MONEYMONEY_JWT_SECRET: 'benchmark-only-secret-0123456789abcdef' },
});
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
(async () => {
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/api/health/live')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const authContext = await browser.newContext();
    const login = await authContext.request.post(base + '/api/auth/login', { data: { username: 'benchmark-owner', password: 'benchmark-only-92!' } });
    if (!login.ok()) throw new Error(`benchmark login failed (${login.status()})`);
    const storageState = await authContext.storageState();
    await authContext.close();
    const samples = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', storageState });
        const page = await context.newPage();
        await page.addInitScript(() => {
          localStorage.setItem('mm-market-scope', 'stocks'); localStorage.setItem('mm-last-tab', 'stocks');
          localStorage.setItem('mm-theme', 'dark');
          window.__benchmarkApiRequests=[];
          const nativeFetch=window.fetch.bind(window);
          window.fetch=async(input,options)=>{
            const url=new URL(typeof input==='string'?input:input.url,location.href),pathname=url.pathname;
            if(!pathname.startsWith('/api/'))return nativeFetch(input,options);
            window.__benchmarkApiRequests.push(pathname);
            if(pathname.startsWith('/api/auth/')||pathname==='/api/workspace/navigation')return nativeFetch(input,options);
            const payload=pathname==='/api/stock/kline'?{success:true,dataStatus:'delayed',source:'controlled-browser-fixture',updatedAt:new Date().toISOString(),data:Array.from({length:30},(_,i)=>({time:Date.UTC(2026,8,i+1),open:100+i,close:101+i,high:102+i,low:99+i,volume:1000}))}:{success:false,data:null,dataStatus:'unavailable',reason:'受控基准：来源不可用'};
            return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
          };
        });
        const requests = [];
        page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 750 * 1024 / 8, uploadThroughput: 250 * 1024 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        for (const temperature of ['cold', 'warm']) {
          requests.length = 0;
          await page.goto(base + '/?market=stocks&workspace=stock-quotes&instrument=AAPL', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => !!window.mm_authReady && window.mm_isLoggedIn === true
            && document.getElementById('market-workspace-shell')?.dataset.marketScope === 'stocks'
            && document.getElementById('market-workspace-shell')?.dataset.workspace === 'stock-quotes').catch(async error => {
            console.error(JSON.stringify(await page.evaluate(() => ({ auth: !!window.mm_authReady, loggedIn: window.mm_isLoggedIn, scope: document.getElementById('market-workspace-shell')?.dataset.marketScope, workspace: document.getElementById('market-workspace-shell')?.dataset.workspace }))));
            throw error;
          });
          const shellReadyMs = await page.evaluate(() => performance.now());
          await page.waitForFunction(() => window.__benchmarkApiRequests.includes('/api/stock/kline')
            && ['ready', 'empty', 'failed'].includes(document.getElementById('stock-chart-card')?.dataset.klineState)
            && document.getElementById('stock-chart-card')?.getAttribute('aria-busy') !== 'true'
            && !!window.MoneyTradingChart).catch(async error => {
            console.error(JSON.stringify(await page.evaluate(() => ({ url: location.pathname, auth: window.mm_authReady, loggedIn: window.mm_isLoggedIn, shell: document.getElementById('market-workspace-shell')?.dataset.marketScope, state: document.getElementById('stock-chart-card')?.dataset.klineState }))));
            throw error;
          });
          const result = await page.evaluate(shellReadyMs => ({ shellReadyMs, chartReadyMs: performance.now(), chartState: document.getElementById('stock-chart-card')?.dataset.klineState, bytes: performance.getEntriesByType('resource').reduce((sum, row) => sum + row.transferSize, 0), jsBytes: performance.getEntriesByType('resource').filter(row => /\.js/.test(row.name)).reduce((sum, row) => sum + row.transferSize, 0), apiRequests: window.__benchmarkApiRequests }), shellReadyMs);
          assert.ok(result.apiRequests.includes('/api/stock/kline'), 'chart readiness must follow the scoped K-line request');
          samples.push({ viewport: viewport.width, run, temperature, ...result, apiRequests: [...new Set([...requests,...result.apiRequests])] });
        }
        await context.close();
      }
    }
    for(const viewport of [1440,390])for(let run=0;run<3;run++){const cold=samples.find(row=>row.viewport===viewport&&row.run===run&&row.temperature==='cold'),warm=samples.find(row=>row.viewport===viewport&&row.run===run&&row.temperature==='warm');assert.ok(warm.jsBytes<cold.jsBytes*.2,'warm hashed scripts must hit browser cache');}
    console.log(JSON.stringify({ fixture: 'controlled failures + deterministic candles', cpuRate: 4, latencyMs: 80, downloadKbps: 750, samples, medians: [1440, 390].flatMap(viewport => ['cold', 'warm'].map(temperature => { const group = samples.filter(row => row.viewport === viewport && row.temperature === temperature); return { viewport, temperature, shellReadyMs: median(group.map(row => row.shellReadyMs)), chartReadyMs: median(group.map(row => row.chartReadyMs)), jsBytes: median(group.map(row => row.jsBytes)) }; })) }, null, 2));
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT'); setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
