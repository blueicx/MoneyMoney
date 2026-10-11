// Isolated Chromium comparison: use the real local application and providers;
// do not patch the page's fetch implementation or disable the browser cache.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const appRoot = path.resolve(process.env.MONEYMONEY_BENCHMARK_ROOT || path.join(__dirname, '..'));
const benchmarkRunCount = Number(process.env.MONEYMONEY_BENCHMARK_RUNS || 3);
if (!Number.isInteger(benchmarkRunCount) || benchmarkRunCount < 1 || benchmarkRunCount > 3) throw new Error('MONEYMONEY_BENCHMARK_RUNS must be an integer from 1 to 3');
const cpuRate = process.env.MONEYMONEY_BENCHMARK_CPU_RATE === undefined ? 4 : Number(process.env.MONEYMONEY_BENCHMARK_CPU_RATE);
if (!Number.isFinite(cpuRate) || cpuRate < 0 || cpuRate > 8) throw new Error('MONEYMONEY_BENCHMARK_CPU_RATE must be a number from 0 to 8; 0 disables CPU throttling');
const networkProfile = process.env.MONEYMONEY_BENCHMARK_NETWORK || 'weak';
if (!['weak', 'none'].includes(networkProfile)) throw new Error('MONEYMONEY_BENCHMARK_NETWORK must be weak or none');
const allViewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const requestedViewport = process.env.MONEYMONEY_BENCHMARK_VIEWPORT;
const benchmarkViewports = requestedViewport === 'desktop' ? [allViewports[0]]
  : requestedViewport === 'mobile' ? [allViewports[1]]
      : requestedViewport ? (() => { throw new Error('MONEYMONEY_BENCHMARK_VIEWPORT must be desktop or mobile'); })()
      : allViewports;
function waitForPageCondition(page, predicate, phase) {
  let watchdog;
  const pageWait = page.waitForFunction(predicate, null, { timeout: 15_000 });
  pageWait.catch(() => {});
  const nodeWait = new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error(`${phase} exceeded 14s Node watchdog; renderer may be blocked`)), 14_000);
  });
  return Promise.race([pageWait, nodeWait]).finally(() => clearTimeout(watchdog));
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-load-benchmark-'));
const child = spawn(process.execPath, [path.join(appRoot, 'dist', 'web', 'server.js')], {
  cwd: appRoot, stdio: 'ignore',
  env: { ...process.env, MONEYMONEY_DATA_DIR: root, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_POLLING_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', AI_PAPER_TRADING_ENABLED: 'false', MONEYMONEY_DISABLE_GURU_REFRESH: 'true', PRIVATE_KEY: '', API_KEY: '', MONEYMONEY_LOGIN_USER: 'benchmark-owner', MONEYMONEY_LOGIN_PASS: 'benchmark-only-92!', MONEYMONEY_JWT_SECRET: 'benchmark-only-secret-0123456789abcdef' },
});
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
(async () => {
  let browser;
  try {
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/api/health/live')).ok) { healthy = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!healthy) throw new Error('isolated benchmark server did not become healthy within 16 seconds');
    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const authContext = await browser.newContext();
    const login = await authContext.request.post(base + '/api/auth/login', { data: { username: 'benchmark-owner', password: 'benchmark-only-92!' } });
    if (!login.ok()) throw new Error(`benchmark login failed (${login.status()})`);
    const navigationProbeStartedAt = Date.now();
    const navigationProbeResponse = await authContext.request.get(base + '/api/workspace/navigation?scope=stocks', { timeout: 3_000 });
    const navigationStatusProbe = { status: navigationProbeResponse.status(), durationMs: Date.now() - navigationProbeStartedAt };
    const storageState = await authContext.storageState();
    await authContext.close();
    await browser.close();
    browser = null;
    const samples = [];
    for (const viewport of benchmarkViewports) {
      for (let run = 0; run < benchmarkRunCount; run++) {
        // Keep the cold/warm pair together for cache measurement, but isolate
        // each pair in a fresh browser process to prevent renderer memory from
        // one throttled sample contaminating the next.
        browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', storageState });
        const page = await context.newPage();
        const requests = [];
        const apiTimings = [];
        const apiRequestStartedAt = new WeakMap();
        const pageErrors = [];
        const responses = [];
        const failedRequests = [];
        const reportWaitFailure = async (phase, error) => {
          let authStatusProbe = null;
          const controller = new AbortController();
          const probeTimeout = setTimeout(() => controller.abort(), 2_000);
          try {
            const response = await fetch(base + '/api/auth/status', { signal: controller.signal });
            authStatusProbe = { status: response.status, contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length') };
          } catch (probeError) {
            authStatusProbe = { error: probeError.name === 'AbortError' ? 'timed out' : probeError.message };
          } finally { clearTimeout(probeTimeout); }
          console.error(JSON.stringify({ phase, error: error.message, authStatusProbe, navigationStatusProbe, apiRequests: requests, apiTimings, responses, pageErrors, failedRequests }));
          throw error;
        };
        page.on('request', request => {
          const url = new URL(request.url());
          if (url.pathname.startsWith('/api/')) {
            requests.push({ pathname: url.pathname, method: request.method(), url: `${url.pathname}${url.search}` });
            apiRequestStartedAt.set(request, Date.now());
          }
        });
        page.on('requestfinished', async request => {
          const startedAt = apiRequestStartedAt.get(request);
          if (startedAt === undefined) return;
          const response = await request.response().catch(() => null);
          apiTimings.push({ pathname: new URL(request.url()).pathname, status: response?.status() || null, durationMs: Date.now() - startedAt });
        });
        page.on('response', response => {
          const url = new URL(response.url());
          if (url.pathname.startsWith('/api/')) responses.push({ pathname: url.pathname, status: response.status() });
        });
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        if (networkProfile === 'weak') {
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 750 * 1024 / 8, uploadThroughput: 250 * 1024 / 8 });
        }
        if (cpuRate > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        for (const temperature of ['cold', 'warm']) {
          console.log(`benchmark sample start: viewport=${viewport.width} run=${run + 1} mode=${temperature}`);
          requests.length = 0;
          apiTimings.length = 0;
          await page.goto(base + '/?market=stocks&workspace=stock-quotes&instrument=AAPL', { waitUntil: 'commit' });
          console.log(`benchmark navigation committed: viewport=${viewport.width} run=${run + 1} mode=${temperature}`);
          await waitForPageCondition(page, () => !!window.mm_authReady && window.mm_isLoggedIn === true
            && document.getElementById('market-workspace-shell')?.dataset.marketScope === 'stocks'
            && document.getElementById('market-workspace-shell')?.dataset.workspace === 'stock-quotes', 'workspace-ready')
            .catch(error => reportWaitFailure('workspace-ready', error));
          const shellReadyMs = await page.evaluate(() => performance.now());
          console.log(`benchmark workspace ready: viewport=${viewport.width} run=${run + 1} mode=${temperature} shell=${Math.round(shellReadyMs)}ms`);
          await waitForPageCondition(page, () => ['ready', 'empty', 'failed'].includes(document.getElementById('stock-chart-card')?.dataset.klineState)
            && document.getElementById('stock-chart-card')?.getAttribute('aria-busy') !== 'true'
            && !!window.MoneyTradingChart, 'chart-settled')
            .catch(error => reportWaitFailure('chart-settled', error));
          const result = await page.evaluate(shellReadyMs => {
            const resources = performance.getEntriesByType('resource');
            const js = resources.filter(row => /\.js(?:\?|$)/.test(row.name));
            const navigation = performance.getEntriesByType('navigation')[0];
            return { shellReadyMs, chartReadyMs: performance.now(), chartState: document.getElementById('stock-chart-card')?.dataset.klineState,
              chartMessage: document.getElementById('stock-chart-card')?.innerText.slice(0, 500) || '',
              bytes: resources.reduce((sum, row) => sum + row.transferSize, 0), jsBytes: js.reduce((sum, row) => sum + row.transferSize, 0),
              jsResources: js.map(row => ({ path: new URL(row.name).pathname, startTime: row.startTime, duration: row.duration, transferSize: row.transferSize })),
              domContentLoadedMs: navigation?.domContentLoadedEventEnd || null,
              };
          }, shellReadyMs);
          result.apiRequestDetails = [...requests];
          result.apiTimings = [...apiTimings];
          result.apiRequests = requests.map(request => request.pathname);
          result.apiRequestCounts = Object.fromEntries([...new Set(result.apiRequests)].map(path => [path, result.apiRequests.filter(request => request === path).length]));
          assert.ok(result.apiRequests.includes('/api/stock/kline'), 'chart readiness must follow the scoped K-line request');
          console.log(`benchmark sample ready: viewport=${viewport.width} run=${run + 1} mode=${temperature} chart=${Math.round(result.chartReadyMs)}ms`);
          samples.push({ viewport: viewport.width, run, temperature, ...result });
        }
        await context.close();
        await browser.close();
        browser = null;
      }
    }
    for (const viewport of benchmarkViewports.map(item => item.width)) for (let run = 0; run < benchmarkRunCount; run++) {
      const cold = samples.find(row => row.viewport === viewport && row.run === run && row.temperature === 'cold');
      const warm = samples.find(row => row.viewport === viewport && row.run === run && row.temperature === 'warm');
      assert.ok(warm.jsBytes < cold.jsBytes * .2, 'warm hashed scripts must hit browser cache');
      for (const sample of [cold, warm]) for (const pathname of ['/api/stock/kline', '/api/watchlist', '/api/paper/positions']) {
        assert.equal(sample.apiRequestCounts[pathname], 1,
          `${pathname} must be requested once during ${sample.temperature} stock-chart navigation; observed: ${JSON.stringify(sample.apiRequestDetails.filter(request => request.pathname === pathname))}`);
      }
    }
    console.log(JSON.stringify({ data: 'real application providers; source status and reason captured per sample', cpuRate, networkProfile, latencyMs: networkProfile === 'weak' ? 80 : 0, downloadKbps: networkProfile === 'weak' ? 750 : null, samples, medians: benchmarkViewports.flatMap(viewport => ['cold', 'warm'].map(temperature => { const group = samples.filter(row => row.viewport === viewport.width && row.temperature === temperature); return { viewport: viewport.width, temperature, shellReadyMs: median(group.map(row => row.shellReadyMs)), chartReadyMs: median(group.map(row => row.chartReadyMs)), jsBytes: median(group.map(row => row.jsBytes)) }; })) }, null, 2));
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT'); setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
